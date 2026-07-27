use std::collections::BTreeMap;

use shift_glyph_codec::{
    decode_layer, pack_layer, GlyphLayer, LayerAnchor, LayerCodecError, LayerComponent,
    LayerContour, LayerGuideline, LayerLibValue, LayerPoint, LayerPointType, LayerTransform,
};

const EMPTY: &[u8] = include_bytes!("../../../fixtures/glyph-codec/layer-v1/empty.bin");
const FULL: &[u8] = include_bytes!("../../../fixtures/glyph-codec/layer-v1/full.bin");

fn full_layer() -> GlyphLayer {
    let mut nested = BTreeMap::new();
    nested.insert(
        "alpha".to_string(),
        LayerLibValue::String("value".to_string()),
    );
    nested.insert("omega".to_string(), LayerLibValue::Uid(u64::MAX));

    let mut lib = BTreeMap::new();
    lib.insert(
        "array".to_string(),
        LayerLibValue::Array(vec![
            LayerLibValue::Boolean(false),
            LayerLibValue::Boolean(true),
        ]),
    );
    lib.insert("data".to_string(), LayerLibValue::Data(vec![0, 1, 2, 255]));
    lib.insert(
        "date".to_string(),
        LayerLibValue::Date("2026-07-25T12:34:56Z".to_string()),
    );
    lib.insert("dict".to_string(), LayerLibValue::Dict(nested));
    lib.insert("float".to_string(), LayerLibValue::Float(-12.25));
    lib.insert("integer".to_string(), LayerLibValue::Integer(i64::MIN));
    lib.insert(
        "string".to_string(),
        LayerLibValue::String("layer metadata".to_string()),
    );
    lib.insert(
        "unsigned".to_string(),
        LayerLibValue::UnsignedInteger(u64::MAX),
    );

    GlyphLayer {
        id: "layer_A_regular".to_string(),
        source_id: "source_regular".to_string(),
        width: 600.125,
        height: Some(720.5),
        contours: vec![
            LayerContour {
                id: "contour_outer".to_string(),
                closed: true,
                points: vec![
                    LayerPoint {
                        id: "point_0".to_string(),
                        point_type: LayerPointType::OnCurve,
                        smooth: false,
                        x: 100.25,
                        y: -0.0,
                    },
                    LayerPoint {
                        id: "point_1".to_string(),
                        point_type: LayerPointType::OffCurve,
                        smooth: true,
                        x: 300.5,
                        y: 700.75,
                    },
                    LayerPoint {
                        id: "point_2".to_string(),
                        point_type: LayerPointType::QCurve,
                        smooth: false,
                        x: 500.875,
                        y: 0.0,
                    },
                ],
            },
            LayerContour {
                id: "contour_open".to_string(),
                closed: false,
                points: vec![],
            },
        ],
        components: vec![LayerComponent {
            id: "component_acute".to_string(),
            base_glyph_id: "glyph_acute".to_string(),
            base_glyph_name: "acutecomb".to_string(),
            transform: LayerTransform {
                translate_x: 10.0,
                translate_y: 20.0,
                rotation: 5.5,
                scale_x: 1.25,
                scale_y: 0.75,
                skew_x: 2.0,
                skew_y: -1.5,
                center_x: 50.0,
                center_y: 75.0,
            },
        }],
        anchors: vec![
            LayerAnchor {
                id: "anchor_top".to_string(),
                name: Some("top".to_string()),
                x: 300.0,
                y: 700.0,
            },
            LayerAnchor {
                id: "anchor_unnamed".to_string(),
                name: None,
                x: 12.5,
                y: -30.25,
            },
        ],
        guidelines: vec![
            LayerGuideline {
                id: "guideline_baseline".to_string(),
                x: None,
                y: Some(0.0),
                angle: None,
                name: Some("Baseline".to_string()),
                color: Some("0,0,1,1".to_string()),
            },
            LayerGuideline {
                id: "guideline_angle".to_string(),
                x: Some(100.0),
                y: Some(200.0),
                angle: Some(45.0),
                name: None,
                color: None,
            },
        ],
        lib,
    }
}

fn string_section_end(bytes: &[u8]) -> usize {
    let count = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
    72 + (count + 1) * 4 + string_bytes
}

#[test]
fn shared_golden_vectors_decode_and_reencode_byte_for_byte() {
    let expected = full_layer();
    assert_eq!(decode_layer(FULL).unwrap().unpack(), expected);
    assert_eq!(pack_layer(&expected).unwrap().as_bytes(), FULL);

    let empty = GlyphLayer::empty("layer_empty", "source_regular");
    assert_eq!(decode_layer(EMPTY).unwrap().unpack(), empty);
    assert_eq!(pack_layer(&empty).unwrap().as_bytes(), EMPTY);
}

#[test]
fn authored_layer_roundtrips_losslessly() {
    let expected = full_layer();
    let packed = pack_layer(&expected).unwrap();
    let view = packed.view();

    assert_eq!(view.id(), expected.id);
    assert_eq!(view.source_id(), expected.source_id);
    assert_eq!(view.width().to_bits(), expected.width.to_bits());
    assert_eq!(
        view.height().unwrap().to_bits(),
        expected.height.unwrap().to_bits()
    );
    assert_eq!(view.contour_count(), 2);
    assert_eq!(view.point_count(), 3);
    assert_eq!(view.component_count(), 1);
    assert_eq!(view.anchor_count(), 2);
    assert_eq!(view.guideline_count(), 2);
    assert_eq!(view.unpack(), expected);
}

#[test]
fn view_streams_structure_without_materializing_the_layer() {
    let packed = pack_layer(&full_layer()).unwrap();
    let view = packed.view();
    let contours = view.contours().collect::<Vec<_>>();

    assert_eq!(contours[0].id(), "contour_outer");
    assert!(contours[0].closed());
    assert_eq!(contours[0].point_count(), 3);
    assert_eq!(
        contours[0]
            .points()
            .map(|point| (
                point.id(),
                point.point_type(),
                point.x().to_bits(),
                point.y().to_bits()
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                "point_0",
                LayerPointType::OnCurve,
                100.25_f64.to_bits(),
                (-0.0_f64).to_bits()
            ),
            (
                "point_1",
                LayerPointType::OffCurve,
                300.5_f64.to_bits(),
                700.75_f64.to_bits()
            ),
            (
                "point_2",
                LayerPointType::QCurve,
                500.875_f64.to_bits(),
                0.0_f64.to_bits()
            ),
        ]
    );
    assert_eq!(
        view.components().next().unwrap().base_glyph_id(),
        "glyph_acute"
    );
    assert_eq!(view.anchors().nth(1).unwrap().name(), None);
    assert_eq!(view.guidelines().next().unwrap().y(), Some(0.0));
}

#[test]
fn encoding_is_deterministic_across_dictionary_insertion_order() {
    let first = full_layer();
    let mut second = full_layer();
    second.lib = second.lib.into_iter().rev().collect();

    assert_eq!(pack_layer(&first).unwrap(), pack_layer(&second).unwrap());
}

#[test]
fn decoder_rejects_all_truncations_and_trailing_bytes() {
    let bytes = pack_layer(&full_layer()).unwrap().into_bytes();
    for length in 0..bytes.len() {
        assert!(
            decode_layer(&bytes[..length]).is_err(),
            "accepted truncation at {length}"
        );
    }

    let mut trailing = bytes;
    trailing.push(0);
    assert!(matches!(
        decode_layer(&trailing),
        Err(LayerCodecError::LengthMismatch { .. })
    ));
}

#[test]
fn decoder_rejects_framing_flags_types_and_noncanonical_absence() {
    let bytes = pack_layer(&full_layer()).unwrap().into_bytes();

    let mut wrong_magic = bytes.clone();
    wrong_magic[0] = 0;
    assert_eq!(
        decode_layer(&wrong_magic).unwrap_err(),
        LayerCodecError::WrongMagic
    );

    let mut wrong_kind = bytes.clone();
    wrong_kind[4] = 1;
    assert_eq!(
        decode_layer(&wrong_kind).unwrap_err(),
        LayerCodecError::UnsupportedPayloadKind(1)
    );

    let mut wrong_version = bytes.clone();
    wrong_version[5] = 2;
    assert_eq!(
        decode_layer(&wrong_version).unwrap_err(),
        LayerCodecError::UnsupportedVersion(2)
    );

    let mut frame_flags = bytes.clone();
    frame_flags[6] = 1;
    assert_eq!(
        decode_layer(&frame_flags).unwrap_err(),
        LayerCodecError::UnknownFlags(1)
    );

    let mut layer_flags = bytes.clone();
    layer_flags[52] = 2;
    assert_eq!(
        decode_layer(&layer_flags).unwrap_err(),
        LayerCodecError::UnknownLayerFlags(2)
    );

    let mut point_type = bytes;
    let point_type_offset = string_section_end(&point_type) + 12 + 4;
    point_type[point_type_offset] = 3;
    assert!(matches!(
        decode_layer(&point_type),
        Err(LayerCodecError::UnknownPointType { .. })
    ));

    let mut empty = pack_layer(&GlyphLayer::empty("layer_empty", "source_regular"))
        .unwrap()
        .into_bytes();
    empty[71] = 0x80;
    assert!(matches!(
        decode_layer(&empty),
        Err(LayerCodecError::NonCanonicalAbsentNumber {
            field: "height",
            ..
        })
    ));
}

#[test]
fn encoder_rejects_nonfinite_numbers_and_duplicate_identity() {
    let mut nonfinite = full_layer();
    nonfinite.contours[0].points[0].x = f64::NAN;
    assert!(matches!(
        pack_layer(&nonfinite),
        Err(LayerCodecError::NonFiniteNumber { .. })
    ));

    let mut duplicate = full_layer();
    duplicate.contours[0].points[1].id = duplicate.contours[0].points[0].id.clone();
    assert!(matches!(
        pack_layer(&duplicate),
        Err(LayerCodecError::DuplicateIdentity { kind: "point", .. })
    ));
}

#[test]
fn mutated_payloads_never_panic_and_accepted_bytes_reencode_canonically() {
    let seed = pack_layer(&full_layer()).unwrap().into_bytes();
    let mut random = 0x81d2_67a5_u32;

    for iteration in 0..10_000 {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        let mut candidate = seed.clone();
        let offset = random as usize % candidate.len();
        candidate[offset] ^= (random >> 24) as u8 | 1;
        if iteration % 7 == 0 {
            candidate.truncate(random as usize % candidate.len());
        } else if iteration % 11 == 0 {
            candidate.push((random >> 16) as u8);
        }

        if let Ok(view) = decode_layer(&candidate) {
            assert_eq!(pack_layer(&view.unpack()).unwrap().as_bytes(), candidate);
        }
    }
}
