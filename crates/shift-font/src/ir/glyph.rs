use crate::anchor::Anchor;
use crate::collection::{EntityList, Identified};
use crate::component::Component;
use crate::contour::Contour;
use crate::entity::{
    AnchorId, AxisId, ComponentId, ContourId, GlyphId, GlyphSourceId, GlyphVariantId, GuidelineId,
    LayerId, PointId, SourceId,
};
use crate::guideline::Guideline;
use crate::lib_data::LibData;
use crate::point::Point;
use crate::{Condition, GlyphName, Location};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphAxis {
    id: AxisId,
    name: String,
    minimum: f64,
    default: f64,
    maximum: f64,
}

impl Identified for GlyphAxis {
    type Id = AxisId;

    fn id(&self) -> Self::Id {
        GlyphAxis::id(self)
    }
}

impl GlyphAxis {
    pub fn new(name: String, minimum: f64, default: f64, maximum: f64) -> Self {
        Self::with_id(AxisId::new(), name, minimum, default, maximum)
    }

    pub fn with_id(id: AxisId, name: String, minimum: f64, default: f64, maximum: f64) -> Self {
        Self {
            id,
            name,
            minimum,
            default,
            maximum,
        }
    }

    pub fn id(&self) -> AxisId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn minimum(&self) -> f64 {
        self.minimum
    }

    pub fn default(&self) -> f64 {
        self.default
    }

    pub fn maximum(&self) -> f64 {
        self.maximum
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphSource {
    id: GlyphSourceId,
    name: String,
    layer_id: LayerId,
    base_source_id: Option<SourceId>,
    location: Location,
}

impl Identified for GlyphSource {
    type Id = GlyphSourceId;

    fn id(&self) -> Self::Id {
        GlyphSource::id(self)
    }
}

impl GlyphSource {
    pub fn new(
        name: String,
        layer_id: LayerId,
        base_source_id: Option<SourceId>,
        location: Location,
    ) -> Self {
        Self::with_id(
            GlyphSourceId::new(),
            name,
            layer_id,
            base_source_id,
            location,
        )
    }

    pub fn with_id(
        id: GlyphSourceId,
        name: String,
        layer_id: LayerId,
        base_source_id: Option<SourceId>,
        location: Location,
    ) -> Self {
        Self {
            id,
            name,
            layer_id,
            base_source_id,
            location,
        }
    }

    pub fn id(&self) -> GlyphSourceId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn layer_id(&self) -> LayerId {
        self.layer_id.clone()
    }

    pub fn base_source_id(&self) -> Option<SourceId> {
        self.base_source_id.clone()
    }

    pub fn location(&self) -> &Location {
        &self.location
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphVariant {
    id: GlyphVariantId,
    name: String,
    condition: Condition,
    sources: EntityList<GlyphSource>,
}

impl Identified for GlyphVariant {
    type Id = GlyphVariantId;

    fn id(&self) -> Self::Id {
        GlyphVariant::id(self)
    }
}

impl GlyphVariant {
    pub fn new(name: String, condition: Condition) -> Self {
        Self::with_id(GlyphVariantId::new(), name, condition)
    }

    pub fn with_id(id: GlyphVariantId, name: String, condition: Condition) -> Self {
        Self {
            id,
            name,
            condition,
            sources: EntityList::new(),
        }
    }

    pub fn id(&self) -> GlyphVariantId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn condition(&self) -> &Condition {
        &self.condition
    }

    pub fn sources(&self) -> &EntityList<GlyphSource> {
        &self.sources
    }

    pub(crate) fn sources_mut(&mut self) -> &mut EntityList<GlyphSource> {
        &mut self.sources
    }

    pub(crate) fn replace_name_condition(&mut self, replacement: &GlyphVariant) {
        self.name = replacement.name.clone();
        self.condition = replacement.condition.clone();
    }

    pub fn source(&self, id: GlyphSourceId) -> Option<&GlyphSource> {
        self.sources.get(&id)
    }

    pub fn insert_source(&mut self, source: GlyphSource) -> Option<GlyphSource> {
        self.sources.insert(source)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Glyph {
    id: GlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
    #[serde(default)]
    axes: EntityList<GlyphAxis>,
    #[serde(default)]
    default_sources: EntityList<GlyphSource>,
    #[serde(default)]
    variants: EntityList<GlyphVariant>,
    layers: HashMap<LayerId, Arc<GlyphLayer>>,
    lib: LibData,
}

impl Identified for Glyph {
    type Id = GlyphId;

    fn id(&self) -> Self::Id {
        Glyph::id(self)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphLayer {
    id: LayerId,
    width: f64,
    height: Option<f64>,
    contours: EntityList<Contour>,
    components: EntityList<Component>,
    anchors: Vec<Anchor>,
    guidelines: Vec<Guideline>,
    lib: LibData,
}

impl GlyphLayer {
    pub fn new(id: LayerId) -> Self {
        Self {
            id,
            width: 0.0,
            height: None,
            contours: EntityList::new(),
            components: EntityList::new(),
            anchors: Vec::new(),
            guidelines: Vec::new(),
            lib: LibData::new(),
        }
    }

    pub fn with_width(id: LayerId, width: f64) -> Self {
        Self {
            width,
            ..Self::new(id)
        }
    }

    pub fn id(&self) -> LayerId {
        self.id.clone()
    }

    pub fn clone_with_identity(&self, id: LayerId) -> Self {
        let mut layer = self.clone();
        layer.id = id;
        layer
    }

    pub fn clone_with_fresh_ids(&self, id: LayerId) -> Self {
        let mut layer = Self::with_width(id, self.width);
        layer.height = self.height;
        layer.lib = self.lib.clone();

        for contour in self.contours_iter() {
            let mut cloned_contour = Contour::new();
            if contour.is_closed() {
                cloned_contour.close();
            }

            for point in contour.points() {
                cloned_contour.push_point(Point::new(
                    PointId::new(),
                    point.x(),
                    point.y(),
                    point.point_type(),
                    point.is_smooth(),
                ));
            }

            layer.add_contour(cloned_contour);
        }

        for component in self.components_iter() {
            let mut cloned = Component::with_transform(
                component.base_glyph_id(),
                component.base_glyph_name().clone(),
                *component.transform(),
            );
            cloned.set_location(component.location().clone());
            cloned.set_axis_inheritance(component.axis_inheritance());
            cloned.set_condition(component.condition().cloned());
            layer.add_component(cloned);
        }

        for anchor in self.anchors_iter() {
            layer.add_anchor(Anchor::new(
                anchor.name().map(ToOwned::to_owned),
                anchor.x(),
                anchor.y(),
            ));
        }

        for guideline in self.guidelines() {
            layer.add_guideline(Guideline::with_id(
                GuidelineId::new(),
                guideline.x(),
                guideline.y(),
                guideline.angle(),
                guideline.name().map(ToOwned::to_owned),
                guideline.color().map(ToOwned::to_owned),
            ));
        }

        layer
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> Option<f64> {
        self.height
    }

    pub fn set_width(&mut self, width: f64) {
        self.width = width;
    }

    pub fn set_height(&mut self, height: Option<f64>) {
        self.height = height;
    }

    pub fn contours(&self) -> &EntityList<Contour> {
        &self.contours
    }

    pub fn contours_iter(&self) -> impl Iterator<Item = &Contour> {
        self.contours.values()
    }

    pub fn contours_iter_mut(&mut self) -> impl Iterator<Item = &mut Contour> {
        self.contours.values_mut()
    }

    pub fn contour(&self, id: ContourId) -> Option<&Contour> {
        self.contours.get(&id)
    }

    pub fn contour_mut(&mut self, id: ContourId) -> Option<&mut Contour> {
        self.contours.get_mut(&id)
    }

    pub fn add_contour(&mut self, contour: Contour) -> ContourId {
        let id = contour.id();
        self.contours.insert(contour);
        id
    }

    pub fn remove_contour(&mut self, id: ContourId) -> Option<Contour> {
        self.contours.shift_remove(&id)
    }

    pub fn clear_contours(&mut self) {
        self.contours.clear();
    }

    pub fn components(&self) -> &EntityList<Component> {
        &self.components
    }

    pub fn components_iter(&self) -> impl Iterator<Item = &Component> {
        self.components.values()
    }

    pub fn components_iter_mut(&mut self) -> impl Iterator<Item = &mut Component> {
        self.components.values_mut()
    }

    pub fn component(&self, id: ComponentId) -> Option<&Component> {
        self.components.get(&id)
    }

    pub(crate) fn component_mut(&mut self, id: ComponentId) -> Option<&mut Component> {
        self.components.get_mut(&id)
    }

    pub fn add_component(&mut self, component: Component) -> ComponentId {
        let id = component.id();
        self.components.insert(component);
        id
    }

    pub fn remove_component(&mut self, id: ComponentId) -> Option<Component> {
        self.components.shift_remove(&id)
    }

    pub fn clear_components(&mut self) {
        self.components.clear();
    }

    pub fn anchors(&self) -> &[Anchor] {
        &self.anchors
    }

    pub fn anchors_iter(&self) -> impl Iterator<Item = &Anchor> {
        self.anchors.iter()
    }

    pub fn anchors_iter_mut(&mut self) -> impl Iterator<Item = &mut Anchor> {
        self.anchors.iter_mut()
    }

    pub fn anchor(&self, id: AnchorId) -> Option<&Anchor> {
        self.anchors.iter().find(|anchor| anchor.id() == id)
    }

    pub fn anchor_mut(&mut self, id: AnchorId) -> Option<&mut Anchor> {
        self.anchors.iter_mut().find(|anchor| anchor.id() == id)
    }

    pub fn anchor_index(&self, id: AnchorId) -> Option<usize> {
        self.anchors.iter().position(|anchor| anchor.id() == id)
    }

    pub fn add_anchor(&mut self, anchor: Anchor) -> AnchorId {
        let id = anchor.id();
        self.anchors.push(anchor);
        id
    }

    pub fn remove_anchor(&mut self, id: AnchorId) -> Option<Anchor> {
        self.anchor_index(id)
            .map(|index| self.anchors.remove(index))
    }

    pub fn clear_anchors(&mut self) {
        self.anchors.clear();
    }

    pub fn set_anchor_position(&mut self, id: AnchorId, x: f64, y: f64) -> bool {
        let Some(anchor) = self.anchor_mut(id) else {
            return false;
        };
        anchor.set_position(x, y);
        true
    }

    pub fn move_anchors(&mut self, ids: &[AnchorId], dx: f64, dy: f64) -> Vec<AnchorId> {
        let mut moved = Vec::new();
        for id in ids {
            if let Some(anchor) = self.anchor_mut(id.clone()) {
                anchor.translate(dx, dy);
                moved.push(id.clone());
            }
        }
        moved
    }

    pub fn guidelines(&self) -> &[Guideline] {
        &self.guidelines
    }

    pub fn add_guideline(&mut self, guideline: Guideline) {
        self.guidelines.push(guideline);
    }

    pub fn lib(&self) -> &LibData {
        &self.lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.lib
    }

    pub fn is_empty(&self) -> bool {
        self.contours.is_empty() && self.components.is_empty() && self.anchors.is_empty()
    }
}

impl Glyph {
    pub fn new(name: impl Into<GlyphName>) -> Self {
        Self::with_id(GlyphId::new(), name)
    }

    /// Constructs with a caller-minted id, so creating callers can hold the
    /// glyph's identity before the glyph exists.
    pub fn with_id(id: GlyphId, name: impl Into<GlyphName>) -> Self {
        Self {
            id,
            name: name.into(),
            unicodes: Vec::new(),
            axes: EntityList::new(),
            default_sources: EntityList::new(),
            variants: EntityList::new(),
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn with_unicode(name: impl Into<GlyphName>, unicode: u32) -> Self {
        Self {
            id: GlyphId::new(),
            name: name.into(),
            unicodes: vec![unicode],
            axes: EntityList::new(),
            default_sources: EntityList::new(),
            variants: EntityList::new(),
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn id(&self) -> GlyphId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        self.name.as_str()
    }

    pub fn glyph_name(&self) -> &GlyphName {
        &self.name
    }

    pub fn set_name(&mut self, name: impl Into<GlyphName>) {
        self.name = name.into();
    }

    pub fn unicodes(&self) -> &[u32] {
        &self.unicodes
    }

    pub fn primary_unicode(&self) -> Option<u32> {
        self.unicodes.first().copied()
    }

    pub fn add_unicode(&mut self, unicode: u32) {
        if !self.unicodes.contains(&unicode) {
            self.unicodes.push(unicode);
        }
    }

    pub fn remove_unicode(&mut self, unicode: u32) {
        self.unicodes.retain(|&u| u != unicode);
    }

    pub fn set_unicodes(&mut self, unicodes: Vec<u32>) {
        self.unicodes = unicodes;
    }

    pub fn axes(&self) -> &EntityList<GlyphAxis> {
        &self.axes
    }

    pub(crate) fn axes_mut(&mut self) -> &mut EntityList<GlyphAxis> {
        &mut self.axes
    }

    pub fn axis(&self, id: AxisId) -> Option<&GlyphAxis> {
        self.axes.get(&id)
    }

    pub fn default_sources(&self) -> &EntityList<GlyphSource> {
        &self.default_sources
    }

    pub(crate) fn default_sources_mut(&mut self) -> &mut EntityList<GlyphSource> {
        &mut self.default_sources
    }

    pub fn source(&self, id: GlyphSourceId) -> Option<&GlyphSource> {
        self.default_sources.get(&id).or_else(|| {
            self.variants
                .values()
                .find_map(|variant| variant.source(id.clone()))
        })
    }

    pub fn variants(&self) -> &EntityList<GlyphVariant> {
        &self.variants
    }

    pub(crate) fn variants_mut(&mut self) -> &mut EntityList<GlyphVariant> {
        &mut self.variants
    }

    pub fn variant(&self, id: GlyphVariantId) -> Option<&GlyphVariant> {
        self.variants.get(&id)
    }

    pub fn insert_axis(&mut self, axis: GlyphAxis) -> Option<GlyphAxis> {
        self.axes.insert(axis)
    }

    pub fn insert_default_source(&mut self, source: GlyphSource) -> Option<GlyphSource> {
        self.default_sources.insert(source)
    }

    pub fn insert_variant(&mut self, variant: GlyphVariant) -> Option<GlyphVariant> {
        self.variants.insert(variant)
    }

    pub fn layer_for_glyph_source(&self, glyph_source_id: GlyphSourceId) -> Option<&GlyphLayer> {
        let layer_id = self.source(glyph_source_id)?.layer_id();
        self.layer(layer_id)
    }

    pub fn layers(&self) -> &HashMap<LayerId, Arc<GlyphLayer>> {
        &self.layers
    }

    pub fn layer(&self, id: LayerId) -> Option<&GlyphLayer> {
        self.layers.get(&id).map(Arc::as_ref)
    }

    pub fn layer_mut(&mut self, id: LayerId) -> Option<&mut GlyphLayer> {
        self.layers.get_mut(&id).map(Arc::make_mut)
    }

    pub fn ensure_layer_for_source(&mut self, source_id: SourceId) -> &mut GlyphLayer {
        if let Some(layer_id) = self
            .default_sources
            .values()
            .find(|source| source.base_source_id().as_ref() == Some(&source_id))
            .map(GlyphSource::layer_id)
        {
            return self
                .layer_mut(layer_id)
                .expect("glyph source layer belongs to glyph");
        }

        let layer_id = LayerId::new();
        self.layers.insert(
            layer_id.clone(),
            Arc::new(GlyphLayer::new(layer_id.clone())),
        );
        self.default_sources.insert(GlyphSource::new(
            source_id.to_string(),
            layer_id.clone(),
            Some(source_id),
            Location::new(),
        ));
        self.layer_mut(layer_id).expect("layer was just inserted")
    }

    pub fn set_layer<L>(&mut self, layer: L)
    where
        L: Into<Arc<GlyphLayer>>,
    {
        let layer = layer.into();
        self.layers.insert(layer.id(), layer);
    }

    /// Returns the first Default glyph-source layer based on a global source.
    ///
    /// Several glyph sources may intentionally share one global base. Stable
    /// glyph-source lookup should be used when that distinction matters.
    pub fn layer_for_source(&self, source_id: SourceId) -> Option<&GlyphLayer> {
        let layer_id = self
            .default_sources
            .values()
            .find(|source| source.base_source_id().as_ref() == Some(&source_id))?
            .layer_id();
        self.layer(layer_id)
    }

    pub fn layer_for_source_mut(&mut self, source_id: SourceId) -> Option<&mut GlyphLayer> {
        let layer_id = self
            .default_sources
            .values()
            .find(|source| source.base_source_id().as_ref() == Some(&source_id))?
            .layer_id();
        self.layer_mut(layer_id)
    }

    pub fn remove_layer(&mut self, id: LayerId) -> Option<GlyphLayer> {
        self.layers.remove(&id).map(Arc::unwrap_or_clone)
    }

    pub fn lib(&self) -> &LibData {
        &self.lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.lib
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Anchor;
    use std::sync::Arc;

    #[test]
    fn glyph_creation() {
        let g = Glyph::with_unicode("A".to_string(), 65);
        assert_eq!(g.name(), "A");
        assert_eq!(g.primary_unicode(), Some(65));
    }

    #[test]
    fn glyph_layer_operations() {
        let mut g = Glyph::new("A".to_string());
        let source_id = SourceId::new();

        let layer = g.ensure_layer_for_source(source_id.clone());
        let layer_id = layer.id();
        layer.set_width(600.0);

        assert_eq!(g.layer(layer_id.clone()).unwrap().width(), 600.0);
        assert_eq!(
            g.layer_for_source(source_id.clone()).unwrap().id(),
            layer_id.clone()
        );
    }

    #[test]
    fn cloned_glyph_shares_layers_until_one_layer_is_mutated() {
        let mut glyph = Glyph::new("A".to_string());
        let first_layer_id = LayerId::new();
        let second_layer_id = LayerId::new();
        glyph.set_layer(GlyphLayer::with_width(first_layer_id.clone(), 500.0));
        glyph.set_layer(GlyphLayer::with_width(second_layer_id.clone(), 600.0));
        let snapshot = glyph.clone();

        glyph
            .layer_mut(first_layer_id.clone())
            .expect("first layer should exist")
            .set_width(700.0);

        assert_eq!(glyph.layer(first_layer_id.clone()).unwrap().width(), 700.0);
        assert_eq!(
            snapshot.layer(first_layer_id.clone()).unwrap().width(),
            500.0
        );
        assert!(!Arc::ptr_eq(
            glyph.layers.get(&first_layer_id).unwrap(),
            snapshot.layers.get(&first_layer_id).unwrap()
        ));
        assert!(Arc::ptr_eq(
            glyph.layers.get(&second_layer_id).unwrap(),
            snapshot.layers.get(&second_layer_id).unwrap()
        ));
    }

    #[test]
    fn glyph_layer_contours() {
        let mut layer = GlyphLayer::with_width(LayerId::new(), 500.0);
        assert!(layer.is_empty());

        let contour = Contour::new();
        let id = layer.add_contour(contour);

        assert!(!layer.is_empty());
        assert!(layer.contour(id).is_some());
    }

    #[test]
    fn glyph_layer_anchors_are_ordered() {
        let mut layer = GlyphLayer::new(LayerId::new());
        let a1 = layer.add_anchor(Anchor::new(Some("top".to_string()), 10.0, 20.0));
        let a2 = layer.add_anchor(Anchor::new(Some("bottom".to_string()), 30.0, 40.0));

        let ids: Vec<_> = layer.anchors_iter().map(|a| a.id()).collect();
        assert_eq!(ids, vec![a1, a2]);
    }
}
