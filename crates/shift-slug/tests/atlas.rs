use shift_glyph_codec::OutlineCommand;
#[cfg(feature = "wgpu-benchmark")]
use shift_slug::SLUG_WGSL;
use shift_slug::{
    pack_render_instances, pack_render_params, AtlasBuilder, Curve, CurveIndexEncoding, Point,
    RenderInstance, RenderParams, SlugError, VariableAtlasBuilder, LINE_EPSILON,
    RENDER_INSTANCE_BYTES, RENDER_PARAMS_BYTES,
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
fn variable_atlas_resolves_source_deltas_and_union_bounds() {
    let base = [
        OutlineCommand::Move { x: 0.0, y: 0.0 },
        OutlineCommand::Quad {
            cx: 50.0,
            cy: 100.0,
            x: 100.0,
            y: 0.0,
        },
        OutlineCommand::Close,
    ];
    let source = [
        OutlineCommand::Move { x: 20.0, y: -10.0 },
        OutlineCommand::Quad {
            cx: 80.0,
            cy: 160.0,
            x: 140.0,
            y: 10.0,
        },
        OutlineCommand::Close,
    ];
    let mut builder = VariableAtlasBuilder::new(8).unwrap();
    builder.add_glyph(base, source).unwrap();
    let atlas = builder.finish();
    let glyph = atlas.glyphs()[0];
    let midpoint = atlas.resolve_glyph(0, 0.5).unwrap();

    assert_eq!(atlas.statistics().glyph_count, 1);
    assert_eq!(midpoint[0].p0, Point::new(10.0, -5.0));
    assert_eq!(midpoint[0].p1, Point::new(65.0, 130.0));
    assert_eq!(midpoint[0].p2, Point::new(120.0, 5.0));
    assert!(glyph.bounds.min_x <= 0.0);
    assert!(glyph.bounds.min_y <= -10.0);
    assert!(glyph.bounds.max_x >= 140.0);
    assert!(glyph.bounds.max_y >= 160.0);
}

#[test]
fn variable_atlas_rejects_incompatible_topology_atomically() {
    let mut builder = VariableAtlasBuilder::default();
    let error = builder
        .add_glyph(
            [
                OutlineCommand::Move { x: 0.0, y: 0.0 },
                OutlineCommand::Line { x: 10.0, y: 10.0 },
            ],
            [
                OutlineCommand::Move { x: 0.0, y: 0.0 },
                OutlineCommand::Quad {
                    cx: 5.0,
                    cy: 5.0,
                    x: 10.0,
                    y: 10.0,
                },
            ],
        )
        .unwrap_err();

    assert_eq!(
        error,
        SlugError::VariableTopologyMismatch { glyph_index: 0 }
    );
    assert!(builder.finish().glyphs().is_empty());
}

#[test]
fn variable_atlas_resolves_multiple_deduplicated_weights() {
    let base = Curve {
        p0: Point::new(0.0, 1.0),
        p1: Point::new(2.0, 3.0),
        p2: Point::new(4.0, 5.0),
    };
    let translate = |amount: f32| Curve {
        p0: Point::new(base.p0.x + amount, base.p0.y + amount),
        p1: Point::new(base.p1.x + amount, base.p1.y + amount),
        p2: Point::new(base.p2.x + amount, base.p2.y + amount),
    };
    let mut builder = VariableAtlasBuilder::default();
    builder
        .add_curve_glyph_with_sources(
            [base],
            2,
            [(5, vec![translate(10.0)]), (7, vec![translate(20.0)])],
        )
        .unwrap();
    let atlas = builder.finish();
    let mut weights = [0.0; 8];
    weights[2] = 0.2;
    weights[5] = 0.3;
    weights[7] = 0.5;
    let resolved = atlas.resolve_glyph_with_weights(0, &weights).unwrap();

    assert_eq!(resolved[0].p0, Point::new(13.0, 14.0));
    assert_eq!(atlas.glyphs()[0].source_count, 3);
    assert_eq!(atlas.sources()[0].weight_index, 2);
    assert_eq!(atlas.sources()[1].weight_index, 5);
    assert_eq!(atlas.sources()[2].weight_index, 7);
}

#[test]
fn variable_sources_use_sparse_deltas_only_when_they_reduce_bytes() {
    let base = [
        Curve {
            p0: Point::new(0.0, 0.0),
            p1: Point::new(1.0, 1.0),
            p2: Point::new(2.0, 2.0),
        },
        Curve {
            p0: Point::new(3.0, 3.0),
            p1: Point::new(4.0, 4.0),
            p2: Point::new(5.0, 5.0),
        },
        Curve {
            p0: Point::new(6.0, 6.0),
            p1: Point::new(7.0, 7.0),
            p2: Point::new(8.0, 8.0),
        },
    ];
    let mut source = base;
    source[1].p1.x += 10.0;
    let mut builder = VariableAtlasBuilder::default();
    builder
        .add_curve_glyph_with_sources(base, 0, [(1, source.to_vec())])
        .unwrap();
    let atlas = builder.finish();
    let resolved = atlas.resolve_glyph(0, 1.0).unwrap();

    assert_eq!(atlas.curve_deltas().len(), 1);
    assert_eq!(atlas.sparse_deltas(), &[0, 1, 1]);
    assert_eq!(atlas.sources()[1].delta_start, 0x8000_0000);
    assert_eq!(resolved, source);
    assert_eq!(atlas.statistics().dense_delta_source_count, 0);
    assert_eq!(atlas.statistics().sparse_delta_source_count, 1);
}

#[test]
fn variable_packing_is_aligned_deterministic_and_little_endian() {
    let mut builder = VariableAtlasBuilder::default();
    builder
        .add_glyph(
            [
                OutlineCommand::Move { x: 1.5, y: -2.0 },
                OutlineCommand::Line { x: 10.0, y: 20.0 },
            ],
            [
                OutlineCommand::Move { x: 2.5, y: -4.0 },
                OutlineCommand::Line { x: 12.0, y: 24.0 },
            ],
        )
        .unwrap();
    let atlas = builder.finish();
    let first = atlas.pack(256).unwrap();
    let second = atlas.pack(256).unwrap();
    let layout = first.layout();

    assert_eq!(first, second);
    assert_eq!(first.as_bytes().len(), layout.total_length);
    assert_eq!(layout.curve_deltas.offset % 256, 0);
    assert_eq!(layout.sparse_deltas.offset % 256, 0);
    assert_eq!(layout.glyphs.offset % 256, 0);
    assert_eq!(layout.sources.offset % 256, 0);
    assert_eq!(layout.line_bits.offset % 256, 0);
    assert_eq!(&first.as_bytes()[..4], &1.5_f32.to_le_bytes());
    assert_eq!(
        &first.as_bytes()[layout.curve_deltas.offset..layout.curve_deltas.offset + 4],
        &1.0_f32.to_le_bytes()
    );
    assert_eq!(atlas.line_bits(), &[0b11]);
    assert_eq!(
        &first.as_bytes()[layout.line_bits.offset..layout.line_bits.offset + 4],
        &3_u32.to_le_bytes()
    );

    let mut streamed = Vec::new();
    atlas
        .write_packed_chunks(256, 256, |chunk| {
            assert_eq!(chunk.offset, streamed.len());
            streamed.extend_from_slice(chunk.bytes);
        })
        .unwrap();
    assert_eq!(streamed, first.as_bytes());

    let chunks = first.chunks(256).unwrap().collect::<Vec<_>>();
    assert!(chunks.iter().all(|chunk| chunk.offset % 4 == 0));
    assert!(chunks.iter().all(|chunk| chunk.bytes.len() <= 256));
    assert_eq!(
        chunks
            .iter()
            .flat_map(|chunk| chunk.bytes.iter().copied())
            .collect::<Vec<_>>(),
        first.as_bytes()
    );
    assert_eq!(first.chunks(3).unwrap_err(), SlugError::InvalidChunkSize(3));
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
        scratch_curve_start: 3,
        scratch_band_start: 5,
        scratch_index_start: 7,
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
    assert_eq!(&bytes[36..40], &3_u32.to_le_bytes());
    assert_eq!(&bytes[40..44], &5_u32.to_le_bytes());
    assert_eq!(&bytes[44..48], &7_u32.to_le_bytes());
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
    let variable_module = naga::front::wgsl::parse_str(shift_slug::VARIABLE_SLUG_WGSL).unwrap();
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    )
    .validate(&variable_module)
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

    for (name, expected_span) in [
        ("VariableParams", 16),
        ("Instance", 48),
        ("Curve", 24),
        ("VariableGlyph", 32),
        ("VariableSource", 8),
        ("Band", 8),
    ] {
        let ty = variable_module
            .types
            .iter()
            .map(|(_, ty)| ty)
            .find(|ty| ty.name.as_deref() == Some(name))
            .unwrap();
        let naga::TypeInner::Struct { span, .. } = ty.inner else {
            panic!("{name} is not a WGSL struct");
        };
        assert_eq!(
            span, expected_span,
            "unexpected variable WGSL span for {name}"
        );
    }
}
