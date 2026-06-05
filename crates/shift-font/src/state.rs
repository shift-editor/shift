//! Canonical glyph state and edit-result types for Shift's font model.
//!
//! These types split stable glyph structure from mutable numeric values. The
//! values layout is canonical and must stay in lockstep with every consumer.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::{
    error::{CoreError, CoreResult},
    Anchor, AnchorId, Component, ComponentId, Contour, ContourId, DecomposedTransform as Transform,
    GlyphLayer, GlyphName, GuidelineId, Location, Point, PointId, PointType,
};

/// Flat numeric glyph values ordered to match `GlyphStructure`.
///
/// This layout is structure-dependent:
///
/// 1. x advance
/// 2. contour point positions, in `GlyphStructure.contours` order:
///    `x, y` for each point
/// 3. anchor positions, in `GlyphStructure.anchors` order:
///    `x, y` for each anchor
/// 4. component transforms, in `GlyphStructure.components` order:
///    `translateX, translateY, rotation, scaleX, scaleY,
///     skewX, skewY, tCenterX, tCenterY` for each component
pub type GlyphValue = f64;

pub type GlyphValues = Vec<GlyphValue>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphState {
    pub structure: GlyphStructure,
    /// Numeric glyph state ordered to match `GlyphStructure`.
    pub values: GlyphValues,
    pub variation_data: Option<GlyphVariationData>,
}

impl GlyphState {
    pub fn from_layer(layer: &GlyphLayer, variation_data: Option<GlyphVariationData>) -> Self {
        Self {
            structure: GlyphStructure::from(layer),
            values: values_from_layer(layer),
            variation_data,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphStructure {
    pub contours: Vec<ContourData>,
    pub anchors: Vec<AnchorData>,
    pub components: Vec<ComponentData>,
}

impl From<&GlyphLayer> for GlyphStructure {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            contours: layer.contours_iter().map(ContourData::from).collect(),
            anchors: layer.anchors_iter().map(AnchorData::from).collect(),
            components: sorted_components(layer)
                .into_iter()
                .map(ComponentData::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourData {
    pub id: String,
    pub points: Vec<PointData>,
    pub closed: bool,
}

impl From<&Contour> for ContourData {
    fn from(contour: &Contour) -> Self {
        Self {
            id: contour.id().to_string(),
            points: contour.points().iter().map(PointData::from).collect(),
            closed: contour.is_closed(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointData {
    pub id: String,
    pub point_type: PointType,
    pub smooth: bool,
}

impl From<&Point> for PointData {
    fn from(point: &Point) -> Self {
        Self {
            id: point.id().to_string(),
            point_type: point.point_type(),
            smooth: point.is_smooth(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorData {
    pub id: String,
    pub name: Option<String>,
}

impl From<&Anchor> for AnchorData {
    fn from(anchor: &Anchor) -> Self {
        Self {
            id: anchor.id().to_string(),
            name: anchor.name().map(str::to_owned),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentData {
    pub id: String,
    pub base_glyph_name: GlyphName,
}

impl From<&Component> for ComponentData {
    fn from(component: &Component) -> Self {
        Self {
            id: component.id().to_string(),
            base_glyph_name: component.base_glyph().clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlyphChangedEntities {
    pub point_ids: Vec<PointId>,
    pub contour_ids: Vec<ContourId>,
    pub anchor_ids: Vec<AnchorId>,
    pub guideline_ids: Vec<GuidelineId>,
    pub component_ids: Vec<ComponentId>,
}

impl GlyphChangedEntities {
    pub fn point(id: PointId) -> Self {
        Self {
            point_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn points(ids: Vec<PointId>) -> Self {
        Self {
            point_ids: ids,
            ..Default::default()
        }
    }

    pub fn contour(id: ContourId) -> Self {
        Self {
            contour_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn contours(ids: Vec<ContourId>) -> Self {
        Self {
            contour_ids: ids,
            ..Default::default()
        }
    }

    pub fn anchor(id: AnchorId) -> Self {
        Self {
            anchor_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn guideline(id: GuidelineId) -> Self {
        Self {
            guideline_ids: vec![id],
            ..Default::default()
        }
    }

    pub fn component(id: ComponentId) -> Self {
        Self {
            component_ids: vec![id],
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphValueChange {
    pub values: GlyphValues,
    pub changed: GlyphChangedEntities,
}

impl GlyphValueChange {
    pub fn from_layer(layer: &GlyphLayer, changed: GlyphChangedEntities) -> Self {
        Self {
            values: values_from_layer(layer),
            changed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphStructureChange {
    pub structure: GlyphStructure,
    pub values: GlyphValues,
    pub changed: GlyphChangedEntities,
}

impl GlyphStructureChange {
    pub fn from_layer(layer: &GlyphLayer, changed: GlyphChangedEntities) -> Self {
        Self {
            structure: GlyphStructure::from(layer),
            values: values_from_layer(layer),
            changed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisTent {
    pub axis_tag: String,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphVariationData {
    /// One entry per region. Inner = tents on the axes the region depends on.
    pub regions: Vec<Vec<AxisTent>>,
    /// Deltas are flattened in `GlyphState::values` order.
    pub deltas: Vec<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphMaster {
    pub source_id: String,
    pub source_name: String,
    pub is_default_source: bool,
    pub location: Location,
    pub structure: GlyphStructure,
    pub values: GlyphValues,
}

/// Flatten mutable numeric glyph state in the order described by `GlyphState::values`.
pub fn values_from_layer(layer: &GlyphLayer) -> GlyphValues {
    let mut values = Vec::new();
    values.push(layer.width());

    for contour in layer.contours_iter() {
        for point in contour.points() {
            values.push(point.x());
            values.push(point.y());
        }
    }

    for anchor in layer.anchors_iter() {
        values.push(anchor.x());
        values.push(anchor.y());
    }

    for component in sorted_components(layer) {
        push_transform_values(&mut values, component.transform());
    }

    values
}

/// Builds a layer from canonical glyph structure and value buffers.
pub fn layer_from_state(
    structure: &GlyphStructure,
    values: &[GlyphValue],
) -> CoreResult<GlyphLayer> {
    let mut layer = GlyphLayer::new();
    apply_state_to_layer(&mut layer, structure, values)?;
    Ok(layer)
}

/// Replaces a layer's editable geometry from canonical glyph structure and values.
pub fn apply_state_to_layer(
    layer: &mut GlyphLayer,
    structure: &GlyphStructure,
    values: &[GlyphValue],
) -> CoreResult<()> {
    let mut cursor = GlyphValueCursor::new(values);
    let width = cursor.read_x_advance()?;

    layer.clear_contours();
    layer.clear_anchors();
    layer.clear_components();
    layer.set_width(width);

    restore_contours(layer, &structure.contours, &mut cursor)?;
    restore_anchors(layer, &structure.anchors, &mut cursor)?;
    restore_components(layer, &structure.components, &mut cursor)?;

    cursor.finish()?;
    Ok(())
}

/// Components live in a map in the IR, but the values array needs stable
/// ordering. Sort by component ID everywhere structure and values are exported.
fn sorted_components(layer: &GlyphLayer) -> Vec<&Component> {
    let mut components: Vec<_> = layer.components_iter().collect();
    components.sort_by_key(|component| component.id().raw());
    components
}

fn push_transform_values(values: &mut Vec<f64>, transform: &Transform) {
    values.push(transform.translate_x);
    values.push(transform.translate_y);
    values.push(transform.rotation);
    values.push(transform.scale_x);
    values.push(transform.scale_y);
    values.push(transform.skew_x);
    values.push(transform.skew_y);
    values.push(transform.t_center_x);
    values.push(transform.t_center_y);
}

#[derive(Debug, Clone, Copy)]
struct PointPosition {
    x: GlyphValue,
    y: GlyphValue,
}

struct GlyphValueCursor<'a> {
    values: &'a [GlyphValue],
    index: usize,
}

impl<'a> GlyphValueCursor<'a> {
    fn new(values: &'a [GlyphValue]) -> Self {
        Self { values, index: 0 }
    }

    fn read_x_advance(&mut self) -> CoreResult<GlyphValue> {
        self.next()
    }

    fn read_point(&mut self) -> CoreResult<PointPosition> {
        Ok(PointPosition {
            x: self.next()?,
            y: self.next()?,
        })
    }

    fn read_component_transform(&mut self) -> CoreResult<Transform> {
        Ok(Transform {
            translate_x: self.next()?,
            translate_y: self.next()?,
            rotation: self.next()?,
            scale_x: self.next()?,
            scale_y: self.next()?,
            skew_x: self.next()?,
            skew_y: self.next()?,
            t_center_x: self.next()?,
            t_center_y: self.next()?,
        })
    }

    fn finish(self) -> CoreResult<()> {
        if self.index == self.values.len() {
            Ok(())
        } else {
            Err(CoreError::TrailingGlyphValues {
                expected: self.index,
                actual: self.values.len(),
            })
        }
    }

    fn next(&mut self) -> CoreResult<GlyphValue> {
        let idx = self.index;
        let value = self
            .values
            .get(idx)
            .copied()
            .ok_or(CoreError::MissingGlyphValue { index: idx })?;

        self.index += 1;
        Ok(value)
    }
}

fn parse_id<T>(value: &str, invalid: impl FnOnce(String) -> CoreError) -> CoreResult<T>
where
    T: FromStr,
{
    value.parse().map_err(|_| invalid(value.to_string()))
}

fn restore_contours(
    layer: &mut GlyphLayer,
    contours: &[ContourData],
    cursor: &mut GlyphValueCursor<'_>,
) -> CoreResult<()> {
    for contour_data in contours {
        let contour_id: ContourId = parse_id(&contour_data.id, CoreError::InvalidContourId)?;
        let mut new_contour = Contour::with_id(contour_id);

        for point in &contour_data.points {
            let point_id: PointId = parse_id(&point.id, CoreError::InvalidPointId)?;
            let new_pos = cursor.read_point()?;
            new_contour.add_point_with_id(
                point_id,
                new_pos.x,
                new_pos.y,
                point.point_type,
                point.smooth,
            );
        }

        if contour_data.closed {
            new_contour.close();
        }

        layer.add_contour(new_contour);
    }

    Ok(())
}

fn restore_anchors(
    layer: &mut GlyphLayer,
    anchors: &[AnchorData],
    cursor: &mut GlyphValueCursor<'_>,
) -> CoreResult<()> {
    for anchor_data in anchors {
        let anchor_id: AnchorId = parse_id(&anchor_data.id, CoreError::InvalidAnchorId)?;
        let position = cursor.read_point()?;
        let anchor = Anchor::with_id(anchor_id, anchor_data.name.clone(), position.x, position.y);

        layer.add_anchor(anchor);
    }

    Ok(())
}

fn restore_components(
    layer: &mut GlyphLayer,
    components: &[ComponentData],
    cursor: &mut GlyphValueCursor<'_>,
) -> CoreResult<()> {
    for component_data in components {
        let component_id: ComponentId =
            parse_id(&component_data.id, CoreError::InvalidComponentId)?;
        let transform = cursor.read_component_transform()?;
        let component = Component::with_id(
            component_id,
            component_data.base_glyph_name.clone(),
            transform,
        );

        layer.add_component(component);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_layer() -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(500.0);

        let mut contour = Contour::with_id(ContourId::from_raw(10));
        contour.add_point_with_id(PointId::from_raw(20), 1.0, 2.0, PointType::OnCurve, false);
        contour.add_point_with_id(PointId::from_raw(21), 3.0, 4.0, PointType::OffCurve, true);
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
            "base".to_string(),
            Transform {
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
        let restored = layer_from_state(&structure, &values_from_layer(&layer))?;

        assert_eq!(restored.width(), 500.0);

        let contour = restored.contour(ContourId::from_raw(10)).unwrap();
        assert!(contour.is_closed());
        assert_eq!(contour.points().len(), 2);

        let first = contour.get_point(PointId::from_raw(20)).unwrap();
        assert_eq!((first.x(), first.y()), (1.0, 2.0));
        assert_eq!(first.point_type(), PointType::OnCurve);
        assert!(!first.is_smooth());

        let second = contour.get_point(PointId::from_raw(21)).unwrap();
        assert_eq!((second.x(), second.y()), (3.0, 4.0));
        assert_eq!(second.point_type(), PointType::OffCurve);
        assert!(second.is_smooth());

        let anchor = restored.anchor(AnchorId::from_raw(30)).unwrap();
        assert_eq!(anchor.name(), Some("top"));
        assert_eq!(anchor.position(), (5.0, 6.0));

        let component = restored.component(ComponentId::from_raw(40)).unwrap();
        assert_eq!(component.base_glyph().as_str(), "base");
        assert_eq!(component.transform().translate_x, 7.0);
        assert_eq!(component.transform().t_center_y, 15.0);

        Ok(())
    }

    #[test]
    fn glyph_structure_sorts_components_by_id() {
        let mut layer = GlyphLayer::new();
        layer.add_component(Component::with_id(
            ComponentId::from_raw(200),
            "later".to_string(),
            Transform::identity(),
        ));
        layer.add_component(Component::with_id(
            ComponentId::from_raw(100),
            "earlier".to_string(),
            Transform::identity(),
        ));

        let structure = GlyphStructure::from(&layer);

        assert_eq!(structure.components[0].id, "100");
        assert_eq!(structure.components[1].id, "200");
    }

    #[test]
    fn layer_from_state_rejects_missing_values() {
        let structure = GlyphStructure {
            contours: vec![],
            anchors: vec![],
            components: vec![],
        };

        assert!(matches!(
            layer_from_state(&structure, &[]),
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
            layer_from_state(&structure, &[500.0, 1.0]),
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
            layer_from_state(&structure, &[500.0]),
            Err(CoreError::InvalidContourId(value)) if value == "not-a-contour-id"
        ));
    }
}
