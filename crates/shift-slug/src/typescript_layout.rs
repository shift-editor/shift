//! Generates the TypeScript Slug atlas layout module and checks it against packing.

use std::mem::{offset_of, size_of};

use shift_font::test_support::generated::{TypeScriptModule, assert_generated_file};

use crate::GlyphIndex;
use crate::variable::{
    COMPONENT_GLYPH_FLAG, CURVE_BYTES, GLYPH_OFFSET_MASK, VARIABLE_COMPONENT_GLYPH_BYTES,
    VARIABLE_GLYPH_BYTES, pack_component_glyphs, params_word,
};
use crate::{
    Bounds, Curve, OutlineCommand, RENDER_INSTANCE_BYTES, RENDER_PARAMS_BYTES, RenderInstance,
    VARIABLE_PARAMS_BYTES, VariableAtlasBuilder, VariableComponentGlyph, VariableGlyph,
    pack_render_instances,
};

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn read_f32s<const N: usize>(bytes: &[u8], offset: usize) -> [f32; N] {
    std::array::from_fn(|index| read_f32(bytes, offset + index * size_of::<f32>()))
}

fn read_bounds(bytes: &[u8], offset: usize) -> Bounds {
    Bounds {
        min_x: read_f32(bytes, offset + offset_of!(Bounds, min_x)),
        min_y: read_f32(bytes, offset + offset_of!(Bounds, min_y)),
        max_x: read_f32(bytes, offset + offset_of!(Bounds, max_x)),
        max_y: read_f32(bytes, offset + offset_of!(Bounds, max_y)),
    }
}

#[test]
fn packed_strides_match_shader_struct_sizes() {
    assert_eq!(size_of::<Curve>(), CURVE_BYTES);
    assert_eq!(size_of::<RenderInstance>(), RENDER_INSTANCE_BYTES);
    assert_eq!(size_of::<VariableGlyph>(), VARIABLE_GLYPH_BYTES);
    assert_eq!(
        size_of::<VariableComponentGlyph>(),
        VARIABLE_COMPONENT_GLYPH_BYTES
    );
}

#[test]
fn render_instances_pack_fields_at_their_struct_offsets() {
    let bytes = pack_render_instances(&[RenderInstance {
        pixel_rect: [1.0, 2.0, 3.0, 4.0],
        em_transform: [5.0, 6.0, 7.0, 8.0],
        glyph_index: 11,
        scratch_curve_start: 13,
        scratch_band_start: 17,
        scratch_index_start: 19,
    }])
    .unwrap();

    assert_eq!(
        read_f32s(&bytes, offset_of!(RenderInstance, pixel_rect)),
        [1.0, 2.0, 3.0, 4.0]
    );
    assert_eq!(
        read_f32s(&bytes, offset_of!(RenderInstance, em_transform)),
        [5.0, 6.0, 7.0, 8.0]
    );

    assert_eq!(
        read_u32(&bytes, offset_of!(RenderInstance, glyph_index)),
        11
    );
    assert_eq!(
        read_u32(&bytes, offset_of!(RenderInstance, scratch_curve_start)),
        13
    );
    assert_eq!(
        read_u32(&bytes, offset_of!(RenderInstance, scratch_band_start)),
        17
    );
    assert_eq!(
        read_u32(&bytes, offset_of!(RenderInstance, scratch_index_start)),
        19
    );
}

#[test]
fn variable_glyphs_pack_fields_at_their_struct_offsets() {
    let mut builder = VariableAtlasBuilder::default();
    for offset in [0.0, 100.0] {
        builder
            .add_glyph(
                [
                    OutlineCommand::Move { x: offset, y: 0.0 },
                    OutlineCommand::Line {
                        x: offset + 10.0,
                        y: 0.0,
                    },
                    OutlineCommand::Line {
                        x: offset + 10.0,
                        y: 10.0,
                    },
                ],
                [
                    OutlineCommand::Move { x: offset, y: 0.0 },
                    OutlineCommand::Line {
                        x: offset + 20.0,
                        y: 0.0,
                    },
                    OutlineCommand::Line {
                        x: offset + 20.0,
                        y: 20.0,
                    },
                ],
            )
            .unwrap();
    }
    let atlas = builder.finish();
    let packed = atlas.pack(256).unwrap();
    let bytes = packed.as_bytes();
    let glyph = atlas.glyphs()[1];
    let glyph_offset = packed.layout().glyphs.offset + VARIABLE_GLYPH_BYTES;

    assert_ne!(glyph.curve_start, 0);
    let bounds = glyph.bounds;
    assert!(bounds.min_x != bounds.min_y && bounds.max_x != bounds.max_y);
    assert_eq!(
        read_bounds(bytes, glyph_offset + offset_of!(VariableGlyph, bounds)),
        bounds
    );
    assert_eq!(
        read_u32(bytes, glyph_offset + offset_of!(VariableGlyph, curve_start)),
        glyph.curve_start
    );
    assert_eq!(
        read_u32(bytes, glyph_offset + offset_of!(VariableGlyph, curve_count)),
        glyph.curve_count
    );
    assert_eq!(
        read_u32(
            bytes,
            glyph_offset + offset_of!(VariableGlyph, source_start)
        ),
        glyph.source_start
    );
    assert_eq!(
        read_u32(
            bytes,
            glyph_offset + offset_of!(VariableGlyph, source_count)
        ),
        glyph.source_count
    );
}

#[test]
fn component_glyphs_pack_fields_at_their_struct_offsets() {
    let glyphs = [
        VariableComponentGlyph::default(),
        VariableComponentGlyph {
            part_start: 2,
            part_count: 3,
            component_start: 5,
            component_count: 7,
            root_glyph_index: GlyphIndex::new(11),
            _padding: 13,
        },
    ];
    let bytes = pack_component_glyphs(&glyphs);
    let glyph = VARIABLE_COMPONENT_GLYPH_BYTES;

    assert_eq!(bytes.len(), glyphs.len() * VARIABLE_COMPONENT_GLYPH_BYTES);
    assert_eq!(
        read_u32(
            &bytes,
            glyph + offset_of!(VariableComponentGlyph, part_start)
        ),
        2
    );
    assert_eq!(
        read_u32(
            &bytes,
            glyph + offset_of!(VariableComponentGlyph, part_count)
        ),
        3
    );
    assert_eq!(
        read_u32(
            &bytes,
            glyph + offset_of!(VariableComponentGlyph, component_start)
        ),
        5
    );
    assert_eq!(
        read_u32(
            &bytes,
            glyph + offset_of!(VariableComponentGlyph, component_count)
        ),
        7
    );
    assert_eq!(
        read_u32(
            &bytes,
            glyph + offset_of!(VariableComponentGlyph, root_glyph_index)
        ),
        11
    );
    assert_eq!(
        read_u32(&bytes, glyph + offset_of!(VariableComponentGlyph, _padding)),
        13
    );
}

#[test]
fn generated_file_slug_atlas_layout_is_current() {
    let module = TypeScriptModule::new("crates/shift-slug/src/typescript_layout.rs")
        .number(
            "Byte stride of one resident quadratic curve.",
            "SLUG_CURVE_BYTES",
            CURVE_BYTES,
        )
        .number(
            "Byte stride of one packed render instance.",
            "SLUG_RENDER_INSTANCE_BYTES",
            RENDER_INSTANCE_BYTES,
        )
        .indices(
            "Byte offsets of render instance fields.",
            "SLUG_RENDER_INSTANCE_OFFSETS",
            &[
                ("pixelRect", offset_of!(RenderInstance, pixel_rect)),
                ("emTransform", offset_of!(RenderInstance, em_transform)),
                ("glyphIndex", offset_of!(RenderInstance, glyph_index)),
                (
                    "scratchCurveStart",
                    offset_of!(RenderInstance, scratch_curve_start),
                ),
                (
                    "scratchBandStart",
                    offset_of!(RenderInstance, scratch_band_start),
                ),
                (
                    "scratchIndexStart",
                    offset_of!(RenderInstance, scratch_index_start),
                ),
            ],
        )
        .number(
            "Byte length of the shared render uniform.",
            "SLUG_RENDER_PARAMS_BYTES",
            RENDER_PARAMS_BYTES,
        )
        .number(
            "Byte length of the variable shader uniform.",
            "SLUG_VARIABLE_PARAMS_BYTES",
            VARIABLE_PARAMS_BYTES,
        )
        .indices(
            "Word indices of variable shader uniform values; unlisted words are zero padding.",
            "SLUG_VARIABLE_PARAMS_WORDS",
            &[
                ("instanceCount", params_word::INSTANCE_COUNT),
                ("bandCount", params_word::BAND_COUNT),
                ("atlasSplitOffset", params_word::ATLAS_SPLIT_OFFSET),
                ("baseCurves", params_word::BASE_CURVES),
                ("curveDeltas", params_word::CURVE_DELTAS),
                ("sparseDeltas", params_word::SPARSE_DELTAS),
                ("glyphs", params_word::GLYPHS),
                ("sources", params_word::SOURCES),
                ("sourceAdvances", params_word::SOURCE_ADVANCES),
                ("componentGlyphs", params_word::COMPONENT_GLYPHS),
                ("componentParts", params_word::COMPONENT_PARTS),
                ("components", params_word::COMPONENTS),
                ("componentSources", params_word::COMPONENT_SOURCES),
                ("lineBits", params_word::LINE_BITS),
            ],
        )
        .number(
            "Byte stride of one resident variable glyph.",
            "SLUG_VARIABLE_GLYPH_BYTES",
            VARIABLE_GLYPH_BYTES,
        )
        .indices(
            "Byte offsets of variable glyph fields.",
            "SLUG_VARIABLE_GLYPH_OFFSETS",
            &[
                ("bounds", offset_of!(VariableGlyph, bounds)),
                ("curveStart", offset_of!(VariableGlyph, curve_start)),
                ("curveCount", offset_of!(VariableGlyph, curve_count)),
                ("sourceStart", offset_of!(VariableGlyph, source_start)),
                ("sourceCount", offset_of!(VariableGlyph, source_count)),
            ],
        )
        .number(
            "Byte stride of one resident component glyph.",
            "SLUG_VARIABLE_COMPONENT_GLYPH_BYTES",
            VARIABLE_COMPONENT_GLYPH_BYTES,
        )
        .indices(
            "Byte offsets of component glyph fields.",
            "SLUG_VARIABLE_COMPONENT_GLYPH_OFFSETS",
            &[
                ("partStart", offset_of!(VariableComponentGlyph, part_start)),
                ("partCount", offset_of!(VariableComponentGlyph, part_count)),
                (
                    "componentStart",
                    offset_of!(VariableComponentGlyph, component_start),
                ),
                (
                    "componentCount",
                    offset_of!(VariableComponentGlyph, component_count),
                ),
                (
                    "rootGlyphIndex",
                    offset_of!(VariableComponentGlyph, root_glyph_index),
                ),
            ],
        )
        .hex(
            "Tag on a variable glyph's `sourceStart` selecting a component glyph record.",
            "SLUG_COMPONENT_GLYPH_FLAG",
            COMPONENT_GLYPH_FLAG,
        )
        .hex(
            "Mask recovering the component glyph index from a tagged `sourceStart`.",
            "SLUG_GLYPH_OFFSET_MASK",
            GLYPH_OFFSET_MASK,
        )
        .finish();

    assert_generated_file("packages/types/src/layout/slugAtlas.ts", &module);
}
