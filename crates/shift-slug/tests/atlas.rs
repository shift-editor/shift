use shift_glyph_codec::OutlineCommand;
#[cfg(feature = "wgpu-benchmark")]
use shift_slug::SLUG_WGSL;
use shift_slug::{
    pack_render_instances, pack_render_params, AtlasBuilder, Curve, CurveIndexEncoding, Point,
    RenderInstance, RenderParams, SlugError, LINE_EPSILON, RENDER_INSTANCE_BYTES,
    RENDER_PARAMS_BYTES,
};

#[test]
fn open_contours_are_closed_for_fill_rendering() {
    let mut builder = AtlasBuilder::default();
    builder
        .add_glyph([
            OutlineCommand::Move { x: 0.0, y: 0.0 },
            OutlineCommand::Line { x: 100.0, y: 0.0 },
            OutlineCommand::Line { x: 100.0, y: 100.0 },
        ])
        .unwrap();
    let atlas = builder.finish();

    assert_eq!(atlas.glyphs()[0].curve_count, 3);
    assert_eq!(atlas.curves()[2].p0, Point::new(100.0, 100.0));
    assert_eq!(atlas.curves()[2].p2, Point::new(0.0, 0.0));
}

#[test]
fn cubic_conversion_is_deterministic_and_continuous() {
    let curves = Curve::from_cubic(
        Point::new(0.0, 0.0),
        Point::new(0.0, 100.0),
        Point::new(100.0, 100.0),
        Point::new(100.0, 0.0),
    );

    assert_eq!(curves[0].p0, Point::new(0.0, 0.0));
    assert_eq!(curves[0].p2, curves[1].p0);
    assert_eq!(curves[1].p2, Point::new(100.0, 0.0));
    assert_eq!(curves[0].p2, Point::new(50.0, 75.0));
}

#[test]
fn diagonal_lines_receive_the_reference_epsilon() {
    let curve = Curve::from_line(Point::new(0.0, 0.0), Point::new(100.0, 100.0));

    assert_ne!(curve.p1, Point::new(50.0, 50.0));
    let displacement = (curve.p1.x - 50.0).hypot(curve.p1.y - 50.0);
    assert!((displacement - LINE_EPSILON).abs() < 0.0001);
}

#[test]
fn every_band_range_addresses_its_glyph_curves() {
    let mut builder = AtlasBuilder::new(8).unwrap();
    builder
        .add_glyph([
            OutlineCommand::Move { x: 0.0, y: 0.0 },
            OutlineCommand::Quad {
                cx: 50.0,
                cy: 120.0,
                x: 100.0,
                y: 0.0,
            },
            OutlineCommand::Close,
        ])
        .unwrap();
    let atlas = builder.finish();
    let glyph = atlas.glyphs()[0];
    let (horizontal, vertical) = atlas.bands_for(glyph);

    assert_eq!(horizontal.len(), 8);
    assert_eq!(vertical.len(), 8);
    for band in horizontal.iter().chain(vertical) {
        let start = band.start as usize;
        let end = start + band.count as usize;
        for curve_index in &atlas.curve_indices()[start..end] {
            assert!(*curve_index >= glyph.curve_start);
            assert!(*curve_index < glyph.curve_start + glyph.curve_count);
        }
    }
}

#[test]
fn band_counts_are_not_limited_to_the_reference_eight_bits() {
    let mut commands = vec![OutlineCommand::Move { x: 0.0, y: 0.0 }];
    for x in 1..=300 {
        commands.push(OutlineCommand::Line {
            x: x as f32,
            y: 0.0,
        });
    }
    let mut builder = AtlasBuilder::new(8).unwrap();
    builder.add_glyph(commands).unwrap();
    let atlas = builder.finish();

    assert!(atlas.statistics().max_band_occupancy > u8::MAX.into());
}

#[test]
fn packing_is_aligned_deterministic_and_little_endian() {
    let mut builder = AtlasBuilder::default();
    builder
        .add_glyph([
            OutlineCommand::Move { x: 1.5, y: -2.0 },
            OutlineCommand::Line { x: 10.0, y: 20.0 },
            OutlineCommand::Close,
        ])
        .unwrap();
    let atlas = builder.finish();
    let first = atlas.pack(256).unwrap();
    let second = atlas.pack(256).unwrap();
    let layout = first.layout();

    assert_eq!(first, second);
    assert_eq!(first.as_bytes().len(), layout.total_length);
    assert_eq!(layout.curve_indices.offset % 256, 0);
    assert_eq!(layout.glyphs.offset % 256, 0);
    assert_eq!(layout.bands.offset % 256, 0);
    assert_eq!(&first.as_bytes()[..4], &1.5_f32.to_le_bytes());
}

#[test]
fn compact_indexes_are_glyph_local_and_pair_packed() {
    let mut builder = AtlasBuilder::new(1).unwrap();
    for offset in [0.0, 100.0] {
        builder
            .add_glyph([
                OutlineCommand::Move { x: offset, y: 0.0 },
                OutlineCommand::Line {
                    x: offset + 10.0,
                    y: 10.0,
                },
                OutlineCommand::Close,
            ])
            .unwrap();
    }
    let atlas = builder.finish();
    let wide = atlas
        .pack_with_encoding(256, CurveIndexEncoding::GlobalU32)
        .unwrap();
    let compact = atlas
        .pack_with_encoding(256, CurveIndexEncoding::GlyphLocalU16)
        .unwrap();
    let compact_layout = compact.layout();

    assert_eq!(wide.index_encoding(), CurveIndexEncoding::GlobalU32);
    assert_eq!(compact.index_encoding(), CurveIndexEncoding::GlyphLocalU16);
    assert_eq!(
        compact_layout.curve_indices.length,
        atlas.curve_indices().len().div_ceil(2) * 4
    );
    assert!(compact_layout.curve_indices.length < wide.layout().curve_indices.length);

    let compact_words = compact.as_bytes()[compact_layout.curve_indices.offset
        ..compact_layout.curve_indices.offset + compact_layout.curve_indices.length]
        .chunks_exact(4)
        .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()));
    assert!(compact_words
        .flat_map(|word| [word & 0xffff, word >> 16])
        .all(|index| index < 2));
}

#[test]
fn invalid_inputs_fail_without_partial_glyphs() {
    let mut builder = AtlasBuilder::default();
    let error = builder
        .add_glyph([OutlineCommand::Line { x: 1.0, y: 2.0 }])
        .unwrap_err();

    assert_eq!(
        error,
        SlugError::DrawingCommandWithoutContour { command_index: 0 }
    );
    assert!(builder.finish().glyphs().is_empty());
    assert_eq!(
        AtlasBuilder::new(0).unwrap_err(),
        SlugError::InvalidBandCount(0)
    );
}

#[test]
fn render_inputs_match_the_shared_little_endian_layout() {
    let bytes = pack_render_instances(&[RenderInstance {
        pixel_rect: [1.5, 2.0, 3.0, 4.0],
        em_transform: [-10.0, -20.0, 30.0, 40.0],
        glyph_index: 0x1234_5678,
    }])
    .unwrap();
    let params = pack_render_params(RenderParams {
        viewport_width: 1024.0,
        viewport_height: 768.0,
        cell_padding: 4.0,
    });

    assert_eq!(bytes.len(), RENDER_INSTANCE_BYTES);
    assert_eq!(RENDER_INSTANCE_BYTES, 48);
    assert_eq!(&bytes[0..4], &1.5_f32.to_le_bytes());
    assert_eq!(&bytes[16..20], &(-10.0_f32).to_le_bytes());
    assert_eq!(&bytes[32..36], &0x1234_5678_u32.to_le_bytes());
    assert!(bytes[36..].iter().all(|byte| *byte == 0));
    assert_eq!(params.len(), RENDER_PARAMS_BYTES);
    assert_eq!(&params[8..12], &4.0_f32.to_le_bytes());
    assert_eq!(&params[12..16], &[0; 4]);
}

#[cfg(feature = "wgpu-benchmark")]
#[test]
fn shared_shader_validates_and_has_the_host_side_strides() {
    let module = naga::front::wgsl::parse_str(SLUG_WGSL).unwrap();
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    )
    .validate(&module)
    .unwrap();

    for (name, expected_span) in [
        ("GlobalParams", 16),
        ("Instance", 48),
        ("Curve", 24),
        ("Glyph", 32),
        ("Band", 8),
    ] {
        let ty = module
            .types
            .iter()
            .map(|(_, ty)| ty)
            .find(|ty| ty.name.as_deref() == Some(name))
            .unwrap();
        let naga::TypeInner::Struct { span, .. } = ty.inner else {
            panic!("{name} is not a WGSL struct");
        };
        assert_eq!(span, expected_span, "unexpected WGSL span for {name}");
    }
}
