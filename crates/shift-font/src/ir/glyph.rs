use crate::anchor::Anchor;
use crate::component::Component;
use crate::contour::Contour;
use crate::entity::{AnchorId, ComponentId, ContourId, GlyphId, LayerId, SourceId};
use crate::guideline::Guideline;
use crate::lib_data::LibData;
use crate::GlyphName;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Glyph {
    id: GlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
    layers: HashMap<LayerId, Arc<GlyphLayer>>,
    lib: LibData,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GlyphLayer {
    id: LayerId,
    source_id: SourceId,
    width: f64,
    height: Option<f64>,
    contours: IndexMap<ContourId, Contour>,
    components: HashMap<ComponentId, Component>,
    anchors: Vec<Anchor>,
    guidelines: Vec<Guideline>,
    lib: LibData,
}

impl GlyphLayer {
    pub fn new(id: LayerId, source_id: SourceId) -> Self {
        Self {
            id,
            source_id,
            width: 0.0,
            height: None,
            contours: IndexMap::new(),
            components: HashMap::new(),
            anchors: Vec::new(),
            guidelines: Vec::new(),
            lib: LibData::new(),
        }
    }

    pub fn with_width(id: LayerId, source_id: SourceId, width: f64) -> Self {
        Self {
            width,
            ..Self::new(id, source_id)
        }
    }

    pub fn id(&self) -> LayerId {
        self.id
    }

    pub fn source_id(&self) -> SourceId {
        self.source_id
    }

    pub fn clone_with_identity(&self, id: LayerId, source_id: SourceId) -> Self {
        let mut layer = self.clone();
        layer.id = id;
        layer.source_id = source_id;
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

    pub fn contours(&self) -> &IndexMap<ContourId, Contour> {
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
        self.contours.insert(id, contour);
        id
    }

    pub fn remove_contour(&mut self, id: ContourId) -> Option<Contour> {
        self.contours.shift_remove(&id)
    }

    pub fn clear_contours(&mut self) {
        self.contours.clear();
    }

    pub fn components(&self) -> &HashMap<ComponentId, Component> {
        &self.components
    }

    pub fn components_iter(&self) -> impl Iterator<Item = &Component> {
        self.components.values()
    }

    pub fn component(&self, id: ComponentId) -> Option<&Component> {
        self.components.get(&id)
    }

    pub fn add_component(&mut self, component: Component) -> ComponentId {
        let id = component.id();
        self.components.insert(id, component);
        id
    }

    pub fn remove_component(&mut self, id: ComponentId) -> Option<Component> {
        self.components.remove(&id)
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
            if let Some(anchor) = self.anchor_mut(*id) {
                anchor.translate(dx, dy);
                moved.push(*id);
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
        Self {
            id: GlyphId::new(),
            name: name.into(),
            unicodes: Vec::new(),
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn with_unicode(name: impl Into<GlyphName>, unicode: u32) -> Self {
        Self {
            id: GlyphId::new(),
            name: name.into(),
            unicodes: vec![unicode],
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn id(&self) -> GlyphId {
        self.id
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
            .layers
            .values()
            .find(|layer| layer.source_id() == source_id)
            .map(|layer| layer.id())
        {
            return self.layer_mut(layer_id).expect("layer id came from glyph");
        }

        let layer = GlyphLayer::new(LayerId::new(), source_id);
        let layer_id = layer.id();
        self.layers.insert(layer_id, Arc::new(layer));
        self.layer_mut(layer_id).expect("layer was just inserted")
    }

    pub fn set_layer(&mut self, layer: GlyphLayer) {
        self.layers.insert(layer.id(), Arc::new(layer));
    }

    pub fn layer_for_source(&self, source_id: SourceId) -> Option<&GlyphLayer> {
        self.layers
            .values()
            .find(|layer| layer.source_id() == source_id)
            .map(Arc::as_ref)
    }

    pub fn layer_for_source_mut(&mut self, source_id: SourceId) -> Option<&mut GlyphLayer> {
        self.layers
            .values_mut()
            .find(|layer| layer.source_id() == source_id)
            .map(Arc::make_mut)
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

        let layer = g.ensure_layer_for_source(source_id);
        let layer_id = layer.id();
        layer.set_width(600.0);

        assert_eq!(g.layer(layer_id).unwrap().width(), 600.0);
        assert_eq!(g.layer_for_source(source_id).unwrap().id(), layer_id);
    }

    #[test]
    fn cloned_glyph_shares_layers_until_one_layer_is_mutated() {
        let mut glyph = Glyph::new("A".to_string());
        let first_source_id = SourceId::new();
        let second_source_id = SourceId::new();
        let first_layer_id = LayerId::new();
        let second_layer_id = LayerId::new();
        glyph.set_layer(GlyphLayer::with_width(
            first_layer_id,
            first_source_id,
            500.0,
        ));
        glyph.set_layer(GlyphLayer::with_width(
            second_layer_id,
            second_source_id,
            600.0,
        ));
        let snapshot = glyph.clone();

        glyph
            .layer_mut(first_layer_id)
            .expect("first layer should exist")
            .set_width(700.0);

        assert_eq!(glyph.layer(first_layer_id).unwrap().width(), 700.0);
        assert_eq!(snapshot.layer(first_layer_id).unwrap().width(), 500.0);
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
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::new(), 500.0);
        assert!(layer.is_empty());

        let contour = Contour::new();
        let id = layer.add_contour(contour);

        assert!(!layer.is_empty());
        assert!(layer.contour(id).is_some());
    }

    #[test]
    fn glyph_layer_anchors_are_ordered() {
        let mut layer = GlyphLayer::new(LayerId::new(), SourceId::new());
        let a1 = layer.add_anchor(Anchor::new(Some("top".to_string()), 10.0, 20.0));
        let a2 = layer.add_anchor(Anchor::new(Some("bottom".to_string()), 30.0, 40.0));

        let ids: Vec<_> = layer.anchors_iter().map(|a| a.id()).collect();
        assert_eq!(ids, vec![a1, a2]);
    }
}
