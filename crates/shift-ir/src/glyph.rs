use crate::anchor::Anchor;
use crate::component::Component;
use crate::contour::Contour;
use crate::entity::{AnchorId, ComponentId, ContourId, GlyphId, LayerId};
use crate::guideline::Guideline;
use crate::lib_data::LibData;
use crate::GlyphName;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Glyph {
    id: GlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
    layers: HashMap<LayerId, GlyphLayer>,
    lib: LibData,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GlyphLayer {
    width: f64,
    height: Option<f64>,
    contours: HashMap<ContourId, Contour>,
    components: HashMap<ComponentId, Component>,
    anchors: HashMap<AnchorId, Anchor>,
    guidelines: Vec<Guideline>,
    lib: LibData,
}

impl GlyphLayer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_width(width: f64) -> Self {
        Self {
            width,
            ..Self::default()
        }
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

    pub fn contours(&self) -> &HashMap<ContourId, Contour> {
        &self.contours
    }

    pub fn contours_iter(&self) -> impl Iterator<Item = &Contour> {
        self.contours.values()
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
        self.contours.remove(&id)
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

    pub fn anchors(&self) -> &HashMap<AnchorId, Anchor> {
        &self.anchors
    }

    pub fn anchors_iter(&self) -> impl Iterator<Item = &Anchor> {
        self.anchors.values()
    }

    pub fn anchor(&self, id: AnchorId) -> Option<&Anchor> {
        self.anchors.get(&id)
    }

    pub fn add_anchor(&mut self, anchor: Anchor) -> AnchorId {
        let id = anchor.id();
        self.anchors.insert(id, anchor);
        id
    }

    pub fn remove_anchor(&mut self, id: AnchorId) -> Option<Anchor> {
        self.anchors.remove(&id)
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
        self.contours.is_empty() && self.components.is_empty()
    }
}

impl Glyph {
    pub fn new(name: GlyphName) -> Self {
        Self {
            id: GlyphId::new(),
            name,
            unicodes: Vec::new(),
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn with_unicode(name: GlyphName, unicode: u32) -> Self {
        Self {
            id: GlyphId::new(),
            name,
            unicodes: vec![unicode],
            layers: HashMap::new(),
            lib: LibData::new(),
        }
    }

    pub fn id(&self) -> GlyphId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn set_name(&mut self, name: GlyphName) {
        self.name = name;
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

    pub fn layers(&self) -> &HashMap<LayerId, GlyphLayer> {
        &self.layers
    }

    pub fn layer(&self, id: LayerId) -> Option<&GlyphLayer> {
        self.layers.get(&id)
    }

    pub fn layer_mut(&mut self, id: LayerId) -> Option<&mut GlyphLayer> {
        self.layers.get_mut(&id)
    }

    pub fn get_or_create_layer(&mut self, id: LayerId) -> &mut GlyphLayer {
        self.layers.entry(id).or_default()
    }

    pub fn set_layer(&mut self, id: LayerId, layer: GlyphLayer) {
        self.layers.insert(id, layer);
    }

    pub fn remove_layer(&mut self, id: LayerId) -> Option<GlyphLayer> {
        self.layers.remove(&id)
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

    #[test]
    fn glyph_creation() {
        let g = Glyph::with_unicode("A".to_string(), 65);
        assert_eq!(g.name(), "A");
        assert_eq!(g.primary_unicode(), Some(65));
    }

    #[test]
    fn glyph_layer_operations() {
        let mut g = Glyph::new("A".to_string());
        let layer_id = LayerId::new();

        let layer = g.get_or_create_layer(layer_id);
        layer.set_width(600.0);

        assert_eq!(g.layer(layer_id).unwrap().width(), 600.0);
    }

    #[test]
    fn glyph_layer_contours() {
        let mut layer = GlyphLayer::with_width(500.0);
        assert!(layer.is_empty());

        let contour = Contour::new();
        let id = layer.add_contour(contour);

        assert!(!layer.is_empty());
        assert!(layer.contour(id).is_some());
    }
}
