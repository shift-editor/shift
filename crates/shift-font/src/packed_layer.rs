//! Lossless adaptation between the authoring model and `shift.glyph-layer.v1`.
//!
//! The codec remains independent of `shift-font`; this module owns typed-ID and
//! domain-object validation at the boundary.

use std::collections::HashMap;
use std::str::FromStr;

use shift_glyph_codec as codec;

use crate::{
    Anchor, AnchorId, Component, ComponentId, Contour, ContourId, DecomposedTransform, GlyphId,
    GlyphLayer, GlyphName, Guideline, GuidelineId, LayerId, LibData, LibValue, Point, PointId,
    PointType, SourceId,
};

#[derive(Debug, thiserror::Error)]
pub enum PackedLayerError {
    #[error(transparent)]
    Codec(#[from] codec::LayerCodecError),

    #[error("invalid {kind} {value:?}")]
    InvalidId { kind: &'static str, value: String },

    #[error("invalid base glyph name {0:?}")]
    InvalidGlyphName(String),
}

/// Encodes one editable authored layer without involving SQLite or transport.
pub fn pack_glyph_layer(layer: &GlyphLayer) -> Result<codec::PackedGlyphLayer, PackedLayerError> {
    codec::pack_layer(&to_codec_layer(layer)).map_err(Into::into)
}

/// Validates bytes and materializes exactly one editable authored layer.
pub fn unpack_glyph_layer(bytes: &[u8]) -> Result<GlyphLayer, PackedLayerError> {
    glyph_layer_from_view(codec::decode_layer(bytes)?)
}

/// Materializes one layer from an already-validated borrowed payload view.
pub fn glyph_layer_from_view(
    view: codec::GlyphLayerView<'_>,
) -> Result<GlyphLayer, PackedLayerError> {
    let layer_id = parse_id::<LayerId>("layer id", view.id())?;
    let source_id = parse_id::<SourceId>("source id", view.source_id())?;
    let mut layer = GlyphLayer::with_width(layer_id, source_id, view.width());
    layer.set_height(view.height());

    for contour in view.contours() {
        let contour_id = parse_id::<ContourId>("contour id", contour.id())?;
        let mut decoded = Contour::with_id(contour_id);
        for point in contour.points() {
            decoded.push_point(Point::new(
                parse_id::<PointId>("point id", point.id())?,
                point.x(),
                point.y(),
                from_codec_point_type(point.point_type()),
                point.smooth(),
            ));
        }
        if contour.closed() {
            decoded.close();
        }
        layer.add_contour(decoded);
    }

    for component in view.components() {
        let name = GlyphName::new(component.base_glyph_name()).map_err(|_| {
            PackedLayerError::InvalidGlyphName(component.base_glyph_name().to_owned())
        })?;
        let transform = component.transform();
        layer.add_component(Component::with_id(
            parse_id::<ComponentId>("component id", component.id())?,
            parse_id::<GlyphId>("base glyph id", component.base_glyph_id())?,
            name,
            DecomposedTransform {
                translate_x: transform.translate_x,
                translate_y: transform.translate_y,
                rotation: transform.rotation,
                scale_x: transform.scale_x,
                scale_y: transform.scale_y,
                skew_x: transform.skew_x,
                skew_y: transform.skew_y,
                t_center_x: transform.center_x,
                t_center_y: transform.center_y,
            },
        ));
    }

    for anchor in view.anchors() {
        layer.add_anchor(Anchor::with_id(
            parse_id::<AnchorId>("anchor id", anchor.id())?,
            anchor.name().map(str::to_owned),
            anchor.x(),
            anchor.y(),
        ));
    }

    for guideline in view.guidelines() {
        layer.add_guideline(Guideline::with_id(
            parse_id::<GuidelineId>("guideline id", guideline.id())?,
            guideline.x(),
            guideline.y(),
            guideline.angle(),
            guideline.name().map(str::to_owned),
            guideline.color().map(str::to_owned),
        ));
    }

    *layer.lib_mut() = LibData::from_map(
        view.lib()
            .into_iter()
            .map(|(key, value)| (key, from_codec_lib_value(value)))
            .collect(),
    );
    Ok(layer)
}

fn to_codec_layer(layer: &GlyphLayer) -> codec::GlyphLayer {
    codec::GlyphLayer {
        id: layer.id().as_str().to_owned(),
        source_id: layer.source_id().as_str().to_owned(),
        width: layer.width(),
        height: layer.height(),
        contours: layer
            .contours_iter()
            .map(|contour| codec::LayerContour {
                id: contour.id().as_str().to_owned(),
                closed: contour.is_closed(),
                points: contour
                    .points()
                    .iter()
                    .map(|point| codec::LayerPoint {
                        id: point.id().as_str().to_owned(),
                        point_type: to_codec_point_type(point.point_type()),
                        smooth: point.is_smooth(),
                        x: point.x(),
                        y: point.y(),
                    })
                    .collect(),
            })
            .collect(),
        components: layer
            .components_iter()
            .map(|component| {
                let transform = component.transform();
                codec::LayerComponent {
                    id: component.id().as_str().to_owned(),
                    base_glyph_id: component.base_glyph_id().as_str().to_owned(),
                    base_glyph_name: component.base_glyph_name().as_str().to_owned(),
                    transform: codec::LayerTransform {
                        translate_x: transform.translate_x,
                        translate_y: transform.translate_y,
                        rotation: transform.rotation,
                        scale_x: transform.scale_x,
                        scale_y: transform.scale_y,
                        skew_x: transform.skew_x,
                        skew_y: transform.skew_y,
                        center_x: transform.t_center_x,
                        center_y: transform.t_center_y,
                    },
                }
            })
            .collect(),
        anchors: layer
            .anchors_iter()
            .map(|anchor| codec::LayerAnchor {
                id: anchor.id().as_str().to_owned(),
                name: anchor.name().map(str::to_owned),
                x: anchor.x(),
                y: anchor.y(),
            })
            .collect(),
        guidelines: layer
            .guidelines()
            .iter()
            .map(|guideline| codec::LayerGuideline {
                id: guideline.id().as_str().to_owned(),
                x: guideline.x(),
                y: guideline.y(),
                angle: guideline.angle(),
                name: guideline.name().map(str::to_owned),
                color: guideline.color().map(str::to_owned),
            })
            .collect(),
        lib: layer
            .lib()
            .iter()
            .map(|(key, value)| (key.clone(), to_codec_lib_value(value)))
            .collect(),
    }
}

fn to_codec_point_type(point_type: PointType) -> codec::LayerPointType {
    match point_type {
        PointType::OnCurve => codec::LayerPointType::OnCurve,
        PointType::OffCurve => codec::LayerPointType::OffCurve,
        PointType::QCurve => codec::LayerPointType::QCurve,
    }
}

fn from_codec_point_type(point_type: codec::LayerPointType) -> PointType {
    match point_type {
        codec::LayerPointType::OnCurve => PointType::OnCurve,
        codec::LayerPointType::OffCurve => PointType::OffCurve,
        codec::LayerPointType::QCurve => PointType::QCurve,
    }
}

fn to_codec_lib_value(value: &LibValue) -> codec::LayerLibValue {
    match value {
        LibValue::String(value) => codec::LayerLibValue::String(value.clone()),
        LibValue::Integer(value) => codec::LayerLibValue::Integer(*value),
        LibValue::UnsignedInteger(value) => codec::LayerLibValue::UnsignedInteger(*value),
        LibValue::Float(value) => codec::LayerLibValue::Float(*value),
        LibValue::Boolean(value) => codec::LayerLibValue::Boolean(*value),
        LibValue::Array(values) => {
            codec::LayerLibValue::Array(values.iter().map(to_codec_lib_value).collect())
        }
        LibValue::Dict(values) => codec::LayerLibValue::Dict(
            values
                .iter()
                .map(|(key, value)| (key.clone(), to_codec_lib_value(value)))
                .collect(),
        ),
        LibValue::Data(value) => codec::LayerLibValue::Data(value.clone()),
        LibValue::Date(value) => codec::LayerLibValue::Date(value.clone()),
        LibValue::Uid(value) => codec::LayerLibValue::Uid(*value),
    }
}

fn from_codec_lib_value(value: codec::LayerLibValue) -> LibValue {
    match value {
        codec::LayerLibValue::String(value) => LibValue::String(value),
        codec::LayerLibValue::Integer(value) => LibValue::Integer(value),
        codec::LayerLibValue::UnsignedInteger(value) => LibValue::UnsignedInteger(value),
        codec::LayerLibValue::Float(value) => LibValue::Float(value),
        codec::LayerLibValue::Boolean(value) => LibValue::Boolean(value),
        codec::LayerLibValue::Array(values) => {
            LibValue::Array(values.into_iter().map(from_codec_lib_value).collect())
        }
        codec::LayerLibValue::Dict(values) => LibValue::Dict(
            values
                .into_iter()
                .map(|(key, value)| (key, from_codec_lib_value(value)))
                .collect::<HashMap<_, _>>(),
        ),
        codec::LayerLibValue::Data(value) => LibValue::Data(value),
        codec::LayerLibValue::Date(value) => LibValue::Date(value),
        codec::LayerLibValue::Uid(value) => LibValue::Uid(value),
    }
}

fn parse_id<T>(kind: &'static str, value: &str) -> Result<T, PackedLayerError>
where
    T: FromStr,
{
    value.parse().map_err(|_| PackedLayerError::InvalidId {
        kind,
        value: value.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_font;

    #[test]
    fn complete_domain_layer_roundtrips_through_canonical_bytes() {
        let font = sample_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let layer = glyph
            .layers()
            .values()
            .find(|layer| !layer.lib().is_empty())
            .unwrap();

        let packed = pack_glyph_layer(layer).unwrap();
        let decoded = unpack_glyph_layer(packed.as_bytes()).unwrap();

        assert_eq!(&decoded, layer.as_ref());
        assert_eq!(pack_glyph_layer(&decoded).unwrap(), packed);
    }

    #[test]
    fn adapter_rejects_codec_valid_but_domain_invalid_ids() {
        let encoded =
            codec::pack_layer(&codec::GlyphLayer::empty("wrong", "source_regular")).unwrap();

        assert!(matches!(
            unpack_glyph_layer(encoded.as_bytes()),
            Err(PackedLayerError::InvalidId {
                kind: "layer id",
                ..
            })
        ));
    }

    #[test]
    fn compatible_source_layers_preserve_shared_structure_and_distinct_values() {
        let font = sample_font();
        let glyph = font.glyph_by_name("A").unwrap();
        let reference = glyph
            .layers()
            .values()
            .find(|layer| !layer.lib().is_empty())
            .unwrap();
        let mut source = reference.clone_with_fresh_ids(
            LayerId::from_raw("compatible"),
            SourceId::from_raw("compatible"),
        );
        source.set_width(reference.width() + 50.0);
        source.contours_iter_mut().next().unwrap().points_mut()[0].set_position(125.0, 10.0);
        assert!(reference
            .interpolation_compatibility_with(&source)
            .is_compatible());

        let decoded_reference =
            unpack_glyph_layer(pack_glyph_layer(reference).unwrap().as_bytes()).unwrap();
        let decoded_source =
            unpack_glyph_layer(pack_glyph_layer(&source).unwrap().as_bytes()).unwrap();

        assert!(decoded_reference
            .interpolation_compatibility_with(&decoded_source)
            .is_compatible());
        assert_ne!(
            decoded_reference.contours_iter().next().unwrap().points()[0].x(),
            decoded_source.contours_iter().next().unwrap().points()[0].x()
        );
    }
}
