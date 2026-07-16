//! Strict restore helpers for the shared glyph state wire format.

use std::str::FromStr;

use crate::{AnchorData, ComponentData, ContourData, GlyphStructure, GlyphValue};
use shift_font::{
    Anchor as IrAnchor, AnchorId, Component as IrComponent, ComponentId, Contour as IrContour,
    ContourId, CoreError, CoreResult, DecomposedTransform as IrTransform, GlyphId,
    GlyphInterpolationValues, GlyphLayer, LayerId, PointId, PointType as IrPointType, SourceId,
};

pub fn layer_from_state(
    layer_id: LayerId,
    source_id: SourceId,
    structure: &GlyphStructure,
    values: &[GlyphValue],
) -> CoreResult<GlyphLayer> {
    let mut layer = GlyphLayer::new(layer_id, source_id);
    apply_state_to_layer(&mut layer, structure, values)?;
    Ok(layer)
}

fn apply_state_to_layer(
    layer: &mut GlyphLayer,
    structure: &GlyphStructure,
    values: &[GlyphValue],
) -> CoreResult<()> {
    layer.clear_contours();
    layer.clear_anchors();
    layer.clear_components();

    restore_contours(layer, &structure.contours)?;
    restore_anchors(layer, &structure.anchors)?;
    restore_components(layer, &structure.components)?;

    layer.apply_interpolation_values(&GlyphInterpolationValues::new(values.to_vec()))
}

fn parse_id<T>(value: &str, invalid: impl FnOnce(String) -> CoreError) -> CoreResult<T>
where
    T: FromStr,
{
    value.parse().map_err(|_| invalid(value.to_string()))
}

fn restore_contours(layer: &mut GlyphLayer, contours: &[ContourData]) -> CoreResult<()> {
    for contour_data in contours {
        let contour_id: ContourId = parse_id(&contour_data.id, CoreError::InvalidContourId)?;
        let mut new_contour = IrContour::with_id(contour_id);

        for point in &contour_data.points {
            let point_id: PointId = parse_id(&point.id, CoreError::InvalidPointId)?;
            let point_type = IrPointType::from(point.point_type);
            new_contour.add_point_with_id(point_id, 0.0, 0.0, point_type, point.smooth);
        }

        if contour_data.closed {
            new_contour.close();
        }

        layer.add_contour(new_contour);
    }

    Ok(())
}

fn restore_anchors(layer: &mut GlyphLayer, anchors: &[AnchorData]) -> CoreResult<()> {
    for anchor_data in anchors {
        let anchor_id: AnchorId = parse_id(&anchor_data.id, CoreError::InvalidAnchorId)?;
        let anchor = IrAnchor::with_id(anchor_id, anchor_data.name.clone(), 0.0, 0.0);

        layer.add_anchor(anchor);
    }

    Ok(())
}

fn restore_components(layer: &mut GlyphLayer, components: &[ComponentData]) -> CoreResult<()> {
    for component_data in components {
        let component_id: ComponentId =
            parse_id(&component_data.id, CoreError::InvalidComponentId)?;
        let base_glyph_id: GlyphId = parse_id(
            component_data.base_glyph_id.as_str(),
            CoreError::InvalidGlyphId,
        )?;
        let component = IrComponent::with_id(
            component_id,
            base_glyph_id,
            component_data.base_glyph_name.clone(),
            IrTransform::identity(),
        );

        layer.add_component(component);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::values_from_layer;
    use shift_font::{Anchor, Component, DecomposedTransform, GlyphId, LayerId, SourceId};

    fn sample_layer() -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::new(), 500.0);

        let mut contour = IrContour::with_id(ContourId::from_raw(10));
        contour.add_point_with_id(PointId::from_raw(20), 1.0, 2.0, IrPointType::OnCurve, false);
        contour.add_point_with_id(PointId::from_raw(21), 3.0, 4.0, IrPointType::OffCurve, true);
        contour.close();
        layer.add_contour(contour);

        layer.add_anchor(Anchor::with_id(
            AnchorId::from_raw(30),
            Some("top".to_string()),
            5.0,
            6.0,
        ));

        layer.add_component(Component::with_id(
            ComponentId::from_raw(40),
            GlyphId::from_raw("base"),
            "base".to_string(),
            DecomposedTransform {
                translate_x: 7.0,
                translate_y: 8.0,
                rotation: 9.0,
                scale_x: 10.0,
                scale_y: 11.0,
                skew_x: 12.0,
                skew_y: 13.0,
                t_center_x: 14.0,
                t_center_y: 15.0,
            },
        ));

        layer
    }

    #[test]
    fn values_from_layer_uses_canonical_order() {
        let layer = sample_layer();

        assert_eq!(
            values_from_layer(&layer),
            vec![
                500.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0,
                15.0,
            ]
        );
    }

    #[test]
    fn layer_from_state_restores_ids_structure_and_values() -> CoreResult<()> {
        let layer = sample_layer();
        let structure = GlyphStructure::from(&layer);
        let restored = layer_from_state(
            layer.id(),
            layer.source_id(),
            &structure,
            &values_from_layer(&layer),
        )?;

        assert_eq!(restored.id(), layer.id());
        assert_eq!(restored.source_id(), layer.source_id());
        assert_eq!(restored.width(), 500.0);

        let contour = restored.contour(ContourId::from_raw(10)).unwrap();
        assert!(contour.is_closed());
        assert_eq!(contour.points().len(), 2);

        let first = contour.get_point(PointId::from_raw(20)).unwrap();
        assert_eq!((first.x(), first.y()), (1.0, 2.0));
        assert_eq!(first.point_type(), IrPointType::OnCurve);
        assert!(!first.is_smooth());

        let second = contour.get_point(PointId::from_raw(21)).unwrap();
        assert_eq!((second.x(), second.y()), (3.0, 4.0));
        assert_eq!(second.point_type(), IrPointType::OffCurve);
        assert!(second.is_smooth());

        let anchor = restored.anchor(AnchorId::from_raw(30)).unwrap();
        assert_eq!(anchor.name(), Some("top"));
        assert_eq!(anchor.position(), (5.0, 6.0));

        let component = restored.component(ComponentId::from_raw(40)).unwrap();
        assert_eq!(component.base_glyph_id(), GlyphId::from_raw("base"));
        assert_eq!(component.base_glyph_name().as_str(), "base");
        assert_eq!(component.transform().translate_x, 7.0);
        assert_eq!(component.transform().t_center_y, 15.0);

        Ok(())
    }

    #[test]
    fn glyph_structure_preserves_component_order() {
        let mut layer = GlyphLayer::new(LayerId::new(), SourceId::new());
        layer.add_component(Component::with_id(
            ComponentId::from_raw(200),
            GlyphId::from_raw("later"),
            "later".to_string(),
            DecomposedTransform::identity(),
        ));
        layer.add_component(Component::with_id(
            ComponentId::from_raw(100),
            GlyphId::from_raw("earlier"),
            "earlier".to_string(),
            DecomposedTransform::identity(),
        ));

        let structure = GlyphStructure::from(&layer);

        assert_eq!(structure.components[0].id, "component_200");
        assert_eq!(structure.components[1].id, "component_100");
    }

    #[test]
    fn layer_from_state_rejects_missing_values() {
        let structure = GlyphStructure {
            contours: vec![],
            anchors: vec![],
            components: vec![],
        };

        assert!(matches!(
            layer_from_state(LayerId::new(), SourceId::new(), &structure, &[]),
            Err(CoreError::MissingGlyphValue { index: 0 })
        ));
    }

    #[test]
    fn layer_from_state_rejects_trailing_values() {
        let structure = GlyphStructure {
            contours: vec![],
            anchors: vec![],
            components: vec![],
        };

        assert!(matches!(
            layer_from_state(LayerId::new(), SourceId::new(), &structure, &[500.0, 1.0]),
            Err(CoreError::TrailingGlyphValues {
                expected: 1,
                actual: 2,
            })
        ));
    }

    #[test]
    fn layer_from_state_rejects_invalid_contour_ids() {
        let structure = GlyphStructure {
            contours: vec![ContourData {
                id: "not-a-contour-id".to_string(),
                points: vec![],
                closed: false,
            }],
            anchors: vec![],
            components: vec![],
        };

        assert!(matches!(
            layer_from_state(LayerId::new(), SourceId::new(), &structure, &[500.0]),
            Err(CoreError::InvalidContourId(value)) if value == "not-a-contour-id"
        ));
    }
}
