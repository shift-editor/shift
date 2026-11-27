use crate::anchor::Anchor;
use crate::collection::{EntityList, Identified};
use crate::component::{Component, ConditionalComponent};
use crate::contour::Contour;
use crate::entity::{
    AnchorId, AxisId, ComponentId, ContourId, GlyphEntityId, GlyphId, GuidelineId, LayerId,
    PointId, SourceId,
};
use crate::glyph_axis::GlyphAxis;
use crate::glyph_category::{GlyphCategory, GlyphSubcategory};
use crate::glyph_swap::GlyphSwap;
use crate::guideline::Guideline;
use crate::lib_data::LibData;
use crate::located_layer::LayerLocation;
use crate::mark_color::MarkColor;
use crate::metrics_keys::{MetricsKey, MetricsKeySide, MetricsKeys};
use crate::point::{Canonical, Point};
use crate::{CoreError, CoreResult, GlyphName};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Glyph {
    id: GlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
    /// Set only when it overrides the glyph data category for the name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<GlyphCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sub_category: Option<GlyphSubcategory>,
    /// Sorted by layer id, so a glyph serializes to the same bytes every time.
    layers: BTreeMap<LayerId, Arc<GlyphLayer>>,
    lib: LibData,
    /// Keys that apply in every source; a layer's own keys override them.
    #[serde(default, skip_serializing_if = "MetricsKeys::is_empty")]
    metrics_keys: MetricsKeys,
    /// The colour the glyph is tagged with, in every source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mark_color: Option<MarkColor>,
    /// Axes only this glyph varies along, in the order they were added.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    axes: Vec<GlyphAxis>,
    /// Where text draws another glyph in this one's place: the first
    /// swap whose condition holds; see [`crate::glyph_swap`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    swaps: Vec<GlyphSwap>,
}

impl Identified for Glyph {
    type Id = GlyphId;

    fn id(&self) -> Self::Id {
        Self::id(self)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphLayer {
    id: LayerId,
    /// Where the layer draws. It takes the place the layer's source id had
    /// in stored layers, and a layer exactly on a source still writes only
    /// that id there; see [`LayerLocation`]'s serde.
    location: LayerLocation,
    width: f64,
    height: Option<f64>,
    contours: EntityList<Contour>,
    components: EntityList<Component>,
    anchors: Vec<Anchor>,
    guidelines: Vec<Guideline>,
    lib: LibData,
    /// Keys for this layer's source only, overriding the glyph's.
    ///
    /// Last, and skipped when empty, so layers stored before it existed
    /// still decode from positional MessagePack and unkeyed layers keep the
    /// same bytes.
    #[serde(default, skip_serializing_if = "MetricsKeys::is_empty")]
    metrics_keys: MetricsKeys,
}

impl GlyphLayer {
    /// Returns the id of every contour, point, component, anchor, and guideline
    /// in the layer.
    pub(crate) fn entity_ids(&self) -> impl Iterator<Item = GlyphEntityId> + '_ {
        let contours = self.contours_iter().map(GlyphEntityId::from);
        let points = self.points().map(GlyphEntityId::from);
        let components = self.components_iter().map(GlyphEntityId::from);
        let anchors = self.anchors_iter().map(GlyphEntityId::from);
        let guidelines = self.guidelines().iter().map(GlyphEntityId::from);
        contours
            .chain(points)
            .chain(components)
            .chain(anchors)
            .chain(guidelines)
    }

    /// Returns every point of every contour, in contour order.
    pub fn points(&self) -> impl Iterator<Item = &Point> {
        self.contours_iter()
            .flat_map(|contour| contour.points().iter())
    }

    /// An empty layer exactly on `source_id`.
    pub fn new(id: LayerId, source_id: SourceId) -> Self {
        Self::located(id, LayerLocation::at_source(source_id))
    }

    /// An empty layer that draws at `location` in its glyph's design space:
    /// exactly on a source, or off the sources as a glyph source on the
    /// glyph's own axes, an intermediate on the font's axes, or both. A
    /// location without a base source needs none.
    pub fn located(id: LayerId, location: LayerLocation) -> Self {
        Self {
            id,
            location,
            width: 0.0,
            height: None,
            contours: EntityList::new(),
            components: EntityList::new(),
            anchors: Vec::new(),
            guidelines: Vec::new(),
            lib: LibData::new(),
            metrics_keys: MetricsKeys::new(),
        }
    }

    /// Where this layer draws: exactly on a source, or at a location of its
    /// own.
    pub fn location(&self) -> &LayerLocation {
        &self.location
    }

    /// Whether the layer draws exactly on `source_id`, with no coordinates of
    /// its own: the layer a per-source lookup means.
    pub fn is_at_source(&self, source_id: SourceId) -> bool {
        self.location.exact_source_id() == Some(source_id)
    }

    /// Whether the layer draws at a location of its own rather than exactly
    /// on a source.
    pub fn is_located(&self) -> bool {
        self.location.exact_source_id().is_none()
    }

    /// Moves the layer to `location`.
    pub fn relocate(&mut self, location: LayerLocation) {
        self.location = location;
    }

    /// The layer's own coordinates, for an edit that rewrites values stored
    /// on an axis; `None` for a layer exactly on its source.
    pub(crate) fn own_location_mut(&mut self) -> Option<&mut LayerLocation> {
        self.is_located().then_some(&mut self.location)
    }

    pub fn with_width(id: LayerId, source_id: SourceId, width: f64) -> Self {
        Self {
            width: width.canonical(),
            ..Self::new(id, source_id)
        }
    }

    pub fn id(&self) -> LayerId {
        self.id
    }

    /// The source the layer's location starts from: the source it sits on,
    /// or the base of its own location. `None` for a layer placed by
    /// coordinates alone.
    pub fn source_id(&self) -> Option<SourceId> {
        self.location.base_source_id()
    }

    /// This layer under `id`, exactly on `source_id`.
    pub fn clone_with_identity(&self, id: LayerId, source_id: SourceId) -> Self {
        let mut layer = self.clone();
        layer.id = id;
        layer.location = LayerLocation::at_source(source_id);
        layer
    }

    /// This layer's advance, height, lib, and metrics keys under `id` at
    /// `location`, with no contours, components, anchors, or guidelines:
    /// the start of a copy that rebuilds its content, or a placeholder for
    /// a layer whose content is not loaded.
    pub fn without_content(&self, id: LayerId, location: LayerLocation) -> Self {
        Self {
            width: self.width,
            height: self.height,
            lib: self.lib.clone(),
            metrics_keys: self.metrics_keys.clone(),
            ..Self::located(id, location)
        }
    }

    /// A copy of this layer under `id` at `location`, every contour, point,
    /// component, anchor and guideline with a fresh id.
    pub fn clone_with_fresh_ids(&self, id: LayerId, location: LayerLocation) -> Self {
        let mut layer = self.without_content(id, location);

        let mut renames: Vec<(ContourId, ContourId)> = Vec::new();
        for contour in self.contours_iter() {
            let mut cloned_contour = Contour::new();
            renames.push((contour.id(), cloned_contour.id()));
            if contour.is_closed() {
                cloned_contour.close();
            }

            for point in contour.points() {
                cloned_contour.push_point(point.with_fresh_id());
            }

            layer.add_contour(cloned_contour);
        }
        // The copied lib names the original contours (the stroke lib does);
        // point it at the copies, and drop what names no copied contour.
        layer.remap_stroke_lib_contour_ids(&renames);
        layer.prune_orphan_stroke_lib_entries();

        for component in self.components_iter() {
            layer.add_component(Component::with_transform(
                component.base_glyph_id(),
                component.base_glyph_name().clone(),
                *component.transform(),
            ));
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

    /// The layer with every contour, point, component, anchor and guideline
    /// id derived from the layer's id and the entity's place in it
    /// ([`PointId::derived`] and the like): what a reader of a font file
    /// gives a layer it converts, so every read of the same file names the
    /// layer's entities alike. Content, order and component alignment are
    /// unchanged.
    #[must_use]
    pub fn with_derived_entity_ids(&self) -> Self {
        let namespace = self.id.as_str();
        let mut layer = self.without_content(self.id, self.location.clone());
        let mut renames: Vec<(ContourId, ContourId)> = Vec::new();
        for (contour_index, contour) in self.contours_iter().enumerate() {
            let place = format!("contour {contour_index}");
            let mut derived = Contour::with_id(ContourId::derived(namespace, &place));
            renames.push((contour.id(), derived.id()));
            if contour.is_closed() {
                derived.close();
            }
            for (point_index, point) in contour.points().iter().enumerate() {
                let id = PointId::derived(namespace, &format!("{place} point {point_index}"));
                derived.push_point(Point::new(
                    id,
                    point.x(),
                    point.y(),
                    point.point_type(),
                    point.is_smooth(),
                ));
            }
            layer.add_contour(derived);
        }
        for (index, component) in self.components_iter().enumerate() {
            let mut derived = Component::with_id(
                ComponentId::derived(namespace, &format!("component {index}")),
                component.base_glyph_id(),
                component.base_glyph_name().clone(),
                *component.transform(),
            );
            derived.set_alignment(component.alignment());
            layer.add_component(derived);
        }
        for (index, anchor) in self.anchors_iter().enumerate() {
            layer.add_anchor(Anchor::with_id(
                AnchorId::derived(namespace, &format!("anchor {index}")),
                anchor.name().map(ToOwned::to_owned),
                anchor.x(),
                anchor.y(),
            ));
        }
        for (index, guideline) in self.guidelines().iter().enumerate() {
            layer.add_guideline(Guideline::with_id(
                GuidelineId::derived(namespace, &format!("guideline {index}")),
                guideline.x(),
                guideline.y(),
                guideline.angle(),
                guideline.name().map(ToOwned::to_owned),
                guideline.color().map(ToOwned::to_owned),
            ));
        }
        // The copied lib names the original contours (the stroke lib does);
        // point it at the derived contours, and drop what names none.
        layer.remap_stroke_lib_contour_ids(&renames);
        layer.prune_orphan_stroke_lib_entries();
        layer
    }

    /// Replaces drawing content in font units, preserving layer identity and auxiliary data.
    ///
    /// Contours, anchors, and components retain the supplied order and identities.
    /// Height, location, guidelines, and library data are unchanged.
    /// Font-wide identity and component-reference validation belongs to the font intent path.
    ///
    /// # Errors
    ///
    /// Rejects duplicate drawing identities and non-finite numeric values before mutation.
    pub fn replace_content(
        &mut self,
        width: f64,
        contours: Vec<Contour>,
        anchors: Vec<Anchor>,
        components: Vec<Component>,
    ) -> CoreResult<()> {
        let mut point_ids = HashSet::new();
        let mut anchor_ids = HashSet::new();
        let mut new_contours = EntityList::new();
        let mut new_components = EntityList::new();
        let mut finite = width.is_finite();

        for contour in contours {
            for point in contour.points() {
                if !point_ids.insert(point.id()) {
                    return Err(CoreError::DuplicatePointId(point.id()));
                }
                finite &= point.x().is_finite() && point.y().is_finite();
            }
            let contour_id = contour.id();
            if new_contours.insert(contour).is_some() {
                return Err(CoreError::DuplicateContourId(contour_id));
            }
        }
        for anchor in &anchors {
            if !anchor_ids.insert(anchor.id()) {
                return Err(CoreError::DuplicateAnchorId(anchor.id()));
            }
            finite &= anchor.x().is_finite() && anchor.y().is_finite();
        }
        for component in components {
            let transform = component.transform();
            finite &= [
                transform.translate_x,
                transform.translate_y,
                transform.rotation,
                transform.scale_x,
                transform.scale_y,
                transform.skew_x,
                transform.skew_y,
                transform.t_center_x,
                transform.t_center_y,
            ]
            .iter()
            .all(|value| value.is_finite());
            let component_id = component.id();
            if new_components.insert(component).is_some() {
                return Err(CoreError::DuplicateComponentId(component_id));
            }
        }
        if !finite {
            return Err(CoreError::InvalidPositionUpdateInput {
                kind: "layer content",
                message: "all numeric values must be finite".to_string(),
            });
        }

        self.width = width.canonical();
        self.contours = new_contours;
        self.anchors = anchors;
        self.components = new_components;
        self.prune_orphan_stroke_lib_entries();
        Ok(())
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> Option<f64> {
        self.height
    }

    /// The metrics keys for this layer's source only.
    pub fn metrics_keys(&self) -> &MetricsKeys {
        &self.metrics_keys
    }

    pub fn metrics_keys_mut(&mut self) -> &mut MetricsKeys {
        &mut self.metrics_keys
    }

    pub fn set_width(&mut self, width: f64) {
        self.width = width.canonical();
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

    pub fn contour(&self, id: &ContourId) -> Option<&Contour> {
        self.contours.get(id)
    }

    pub fn contour_mut(&mut self, id: &ContourId) -> Option<&mut Contour> {
        self.contours.get_mut(id)
    }

    pub fn add_contour(&mut self, contour: Contour) -> ContourId {
        let id = contour.id();
        self.contours.insert(contour);
        id
    }

    pub fn remove_contour(&mut self, id: &ContourId) -> Option<Contour> {
        let removed = self.contours.shift_remove(id);
        if removed.is_some() {
            self.prune_orphan_stroke_lib_entries();
        }
        removed
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

    /// Returns the glyph each component draws, in component order.
    pub fn component_glyph_ids(&self) -> impl Iterator<Item = GlyphId> + '_ {
        self.components_iter().map(Component::base_glyph_id)
    }

    pub fn components_iter_mut(&mut self) -> impl Iterator<Item = &mut Component> {
        self.components.values_mut()
    }

    pub fn component(&self, id: &ComponentId) -> Option<&Component> {
        self.components.get(id)
    }

    pub fn component_mut(&mut self, id: &ComponentId) -> Option<&mut Component> {
        self.components.get_mut(id)
    }

    pub fn add_component(&mut self, component: Component) -> ComponentId {
        let id = component.id();
        self.components.insert(component);
        id
    }

    pub fn remove_component(&mut self, id: &ComponentId) -> Option<Component> {
        self.components.shift_remove(id)
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

    /// Returns each anchor's name, in anchor order; `None` for an unnamed anchor.
    pub fn anchor_names(&self) -> impl Iterator<Item = Option<&str>> {
        self.anchors.iter().map(Anchor::name)
    }

    pub fn anchors_iter_mut(&mut self) -> impl Iterator<Item = &mut Anchor> {
        self.anchors.iter_mut()
    }

    pub fn anchor(&self, id: &AnchorId) -> Option<&Anchor> {
        self.anchors.iter().find(|anchor| anchor.id() == *id)
    }

    pub fn anchor_mut(&mut self, id: &AnchorId) -> Option<&mut Anchor> {
        self.anchors.iter_mut().find(|anchor| anchor.id() == *id)
    }

    pub fn anchor_index(&self, id: &AnchorId) -> Option<usize> {
        self.anchors.iter().position(|anchor| anchor.id() == *id)
    }

    pub fn add_anchor(&mut self, anchor: Anchor) -> AnchorId {
        let id = anchor.id();
        self.anchors.push(anchor);
        id
    }

    pub fn remove_anchor(&mut self, id: &AnchorId) -> Option<Anchor> {
        self.anchor_index(id)
            .map(|index| self.anchors.remove(index))
    }

    pub fn clear_anchors(&mut self) {
        self.anchors.clear();
    }

    pub fn set_anchor_position(&mut self, id: &AnchorId, x: f64, y: f64) -> bool {
        let Some(anchor) = self.anchor_mut(id) else {
            return false;
        };
        anchor.set_position(x, y);
        true
    }

    pub fn move_anchors(&mut self, ids: &[AnchorId], dx: f64, dy: f64) -> Vec<AnchorId> {
        let mut moved = Vec::new();
        for id in ids {
            if let Some(anchor) = self.anchor_mut(id) {
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
            category: None,
            sub_category: None,
            layers: BTreeMap::new(),
            lib: LibData::new(),
            metrics_keys: MetricsKeys::new(),
            mark_color: None,
            axes: Vec::new(),
            swaps: Vec::new(),
        }
    }

    pub fn with_unicode(name: impl Into<GlyphName>, unicode: u32) -> Self {
        Self {
            unicodes: vec![unicode],
            ..Self::new(name)
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

    /// The category set explicitly on this glyph, if any.
    pub fn category(&self) -> Option<GlyphCategory> {
        self.category
    }

    /// The subcategory set explicitly on this glyph, if any.
    pub fn sub_category(&self) -> Option<GlyphSubcategory> {
        self.sub_category
    }

    /// Overrides the glyph data category; `None` falls back to it.
    pub fn set_category(&mut self, category: Option<GlyphCategory>) {
        self.category = category;
    }

    /// Overrides the glyph data subcategory; `None` falls back to it.
    pub fn set_sub_category(&mut self, sub_category: Option<GlyphSubcategory>) {
        self.sub_category = sub_category;
    }

    /// The metrics keys that apply in every source.
    pub fn metrics_keys(&self) -> &MetricsKeys {
        &self.metrics_keys
    }

    /// The key for `side` in `source_id`: the layer's own key, or else the
    /// glyph's. `None` when neither has one or the glyph has no layer there.
    pub fn metrics_key(&self, source_id: SourceId, side: MetricsKeySide) -> Option<&MetricsKey> {
        let layer = self.layer_for_source(source_id)?;
        layer
            .metrics_keys()
            .get(side)
            .or_else(|| self.metrics_keys.get(side))
    }

    pub fn metrics_keys_mut(&mut self) -> &mut MetricsKeys {
        &mut self.metrics_keys
    }

    /// The colour the glyph is tagged with, if any. A layer's lib may hold
    /// a colour of its own from the file it came from; this is the one the
    /// editor shows.
    pub fn mark_color(&self) -> Option<MarkColor> {
        self.mark_color
    }

    /// Tags the glyph with `color`, or clears its tag.
    pub fn set_mark_color(&mut self, color: Option<MarkColor>) {
        self.mark_color = color;
    }

    pub fn layers(&self) -> &BTreeMap<LayerId, Arc<GlyphLayer>> {
        &self.layers
    }

    /// Every point, contour, component, anchor, and guideline id across the
    /// glyph's layers, layer by layer.
    pub(crate) fn entity_ids(&self) -> impl Iterator<Item = GlyphEntityId> + '_ {
        self.layers.values().flat_map(|layer| layer.entity_ids())
    }

    /// Whether `other` holds exactly the same entity ids in the same layers,
    /// compared directly rather than hashed.
    pub(crate) fn has_same_entity_ids(&self, other: &Self) -> bool {
        self.layers.len() == other.layers.len()
            && self.layers.iter().all(|(layer_id, layer)| {
                other
                    .layers
                    .get(layer_id)
                    .is_some_and(|other| layer.entity_ids().eq(other.entity_ids()))
            })
    }

    /// Whether any layer draws something: a contour or a component.
    pub fn has_outline(&self) -> bool {
        self.layers
            .values()
            .any(|layer| !layer.contours().is_empty() || !layer.components().is_empty())
    }

    /// Whether any layer has an anchor that marks attach to.
    pub fn has_attaching_anchor(&self) -> bool {
        self.layers
            .values()
            .flat_map(|layer| layer.anchors())
            .any(Anchor::attaches_marks)
    }

    /// Returns the ids of the glyph's layers.
    pub fn layer_ids(&self) -> impl Iterator<Item = LayerId> + '_ {
        self.layers.keys().copied()
    }

    /// Returns the glyph each component draws, across all of the glyph's layers.
    pub fn component_glyph_ids(&self) -> impl Iterator<Item = GlyphId> + '_ {
        self.layers
            .values()
            .flat_map(|layer| layer.component_glyph_ids())
    }

    /// The axes only this glyph varies along, in the order they were added.
    pub fn axes(&self) -> &[GlyphAxis] {
        &self.axes
    }

    /// The glyph's own axis with `axis_id`.
    pub fn axis(&self, axis_id: AxisId) -> Option<&GlyphAxis> {
        self.axes.iter().find(|axis| axis.id() == axis_id)
    }

    /// Gives the glyph `axes`, as a reader of stored glyphs does before
    /// adding the glyph to a font, which checks them.
    pub fn set_axes(&mut self, axes: Vec<GlyphAxis>) {
        self.axes = axes;
    }

    /// The glyph's swaps, in the order they are tried.
    pub fn swaps(&self) -> &[GlyphSwap] {
        &self.swaps
    }

    /// Gives the glyph `swaps`, tried in order, as a reader of stored glyphs
    /// does before adding the glyph to a font, which checks them.
    pub fn set_swaps(&mut self, swaps: Vec<GlyphSwap>) {
        self.swaps = swaps;
    }

    /// The components that carry a condition in any of the glyph's
    /// drawings, by position, each once.
    pub fn conditional_components(&self) -> BTreeSet<ConditionalComponent> {
        self.layers
            .values()
            .flat_map(|layer| {
                layer
                    .components_iter()
                    .enumerate()
                    .filter(|(_, component)| !component.condition().is_always())
                    .map(|(index, component)| ConditionalComponent {
                        position: index + 1,
                        base: component.base_glyph_name().clone(),
                    })
            })
            .collect()
    }

    pub(crate) fn axes_mut(&mut self) -> &mut Vec<GlyphAxis> {
        &mut self.axes
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
            .find(|layer| layer.is_at_source(source_id))
            .map(Identified::id)
        {
            return self.layer_mut(layer_id).expect("layer id came from glyph");
        }

        let layer = GlyphLayer::new(LayerId::new(), source_id);
        let layer_id = layer.id();
        self.layers.insert(layer_id, Arc::new(layer));
        self.layer_mut(layer_id).expect("layer was just inserted")
    }

    pub fn set_layer<L>(&mut self, layer: L)
    where
        L: Into<Arc<GlyphLayer>>,
    {
        let layer = layer.into();
        self.layers.insert(layer.id(), layer);
    }

    pub fn layer_for_source(&self, source_id: SourceId) -> Option<&GlyphLayer> {
        self.shared_layer_for_source(source_id).map(Arc::as_ref)
    }

    /// Returns the glyph's layer on `source_id` as the shared handle the glyph holds.
    pub fn shared_layer_for_source(&self, source_id: SourceId) -> Option<&Arc<GlyphLayer>> {
        self.layers
            .values()
            .find(|layer| layer.is_at_source(source_id))
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

    /// A layer as a reader converts one: fresh entity ids on every call.
    fn converted(id: LayerId, source_id: SourceId) -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(id, source_id, 500.0);
        layer.add_contour(crate::contour![(0.0, 0.0), (100.0, 200.0), (200.0, 0.0)]);
        layer.add_component(Component::new(GlyphId::new(), "base"));
        layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 700.0));
        layer.add_guideline(Guideline::with_id(
            GuidelineId::new(),
            Some(10.0),
            None,
            None,
            None,
            None,
        ));
        layer
    }

    #[test]
    fn derived_entity_ids_name_two_conversions_of_a_layer_alike() {
        let (id, source_id) = (LayerId::new(), SourceId::new());
        let first = converted(id, source_id);
        let second = GlyphLayer {
            components: first.components.clone(),
            ..converted(id, source_id)
        };
        assert_ne!(first, second);

        let derived = first.with_derived_entity_ids();

        assert_eq!(derived, second.with_derived_entity_ids());
        let ids: HashSet<GlyphEntityId> = derived.entity_ids().collect();
        assert_eq!(ids.len(), first.entity_ids().count());
    }

    #[test]
    fn copies_that_rebuild_content_keep_the_layers_metrics_keys() {
        let mut layer = converted(LayerId::new(), SourceId::new());
        layer
            .metrics_keys_mut()
            .set(MetricsKeySide::Right, MetricsKey::new("=|"));

        let derived = layer.with_derived_entity_ids();
        let fresh =
            layer.clone_with_fresh_ids(LayerId::new(), LayerLocation::at_source(SourceId::new()));

        assert_eq!(derived.metrics_keys(), layer.metrics_keys());
        assert_eq!(fresh.metrics_keys(), layer.metrics_keys());
    }

    fn stroked_layer() -> (GlyphLayer, ContourId) {
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::new(), 500.0);
        layer.add_contour(crate::contour![
            (100.0, 0.0),
            (400.0, 0.0),
            (400.0, 700.0),
            (100.0, 700.0)
        ]);

        let contour_id = layer.contours_iter().next().expect("one contour").id();
        layer
            .set_live_stroke_contours(
                std::slice::from_ref(&contour_id),
                crate::stroke::style::OutlineStrokeStyle {
                    width: 40.0,
                    cap: crate::stroke::style::StrokeCap::Round,
                    join: crate::stroke::style::StrokeJoin::Round,
                    miter_limit: 4.0,
                    position: 0.5,
                },
            )
            .expect("a stroked contour on the fixture");
        (layer, contour_id)
    }

    #[test]
    fn a_fresh_ids_copy_keeps_the_stroke_on_its_own_contour() {
        let (layer, original_contour_id) = stroked_layer();

        let fresh =
            layer.clone_with_fresh_ids(LayerId::new(), LayerLocation::at_source(SourceId::new()));

        let copied_contour_id = fresh.contours_iter().next().expect("one contour").id();
        assert_ne!(copied_contour_id, original_contour_id);
        let strokes = fresh.live_strokes();
        let [copied_stroke] = strokes.as_slice() else {
            panic!("the copy keeps exactly one live stroke");
        };
        assert_eq!(copied_stroke.contour_id, copied_contour_id);
        assert_eq!(copied_stroke.style.width, 40.0);
        assert!(fresh.orphan_stroke_lib_contour_ids().is_empty());
        assert!(fresh.stroke_outlines_for_preview(0.25).is_ok());
    }

    #[test]
    fn a_derived_ids_copy_keeps_the_stroke_on_its_own_contour() {
        let (layer, _) = stroked_layer();

        let derived = layer.with_derived_entity_ids();

        let derived_contour_id = derived.contours_iter().next().expect("one contour").id();
        let strokes = derived.live_strokes();
        let [derived_stroke] = strokes.as_slice() else {
            panic!("the converted layer keeps exactly one live stroke");
        };
        assert_eq!(derived_stroke.contour_id, derived_contour_id);
        assert!(derived.orphan_stroke_lib_contour_ids().is_empty());
        assert!(derived.stroke_outlines_for_preview(0.25).is_ok());
    }

    #[test]
    fn derived_entity_ids_differ_between_layers() {
        let source_id = SourceId::new();
        let first = converted(LayerId::new(), source_id).with_derived_entity_ids();
        let second = converted(LayerId::new(), source_id).with_derived_entity_ids();

        let first_ids: HashSet<GlyphEntityId> = first.entity_ids().collect();
        assert!(second.entity_ids().all(|id| !first_ids.contains(&id)));
    }

    #[test]
    fn a_glyph_has_an_outline_when_a_layer_draws_a_contour() {
        let mut glyph = Glyph::new("A".to_string());
        let layer = glyph.ensure_layer_for_source(SourceId::new());
        layer.add_anchor(Anchor::new(Some("top".to_string()), 0.0, 0.0));
        assert!(!glyph.has_outline());

        let layer = glyph.ensure_layer_for_source(SourceId::new());
        layer.add_empty_contour();

        assert!(glyph.has_outline());
    }

    #[test]
    fn only_anchors_without_a_leading_underscore_attach_marks() {
        let mut glyph = Glyph::new("acutecomb".to_string());
        let layer = glyph.ensure_layer_for_source(SourceId::new());
        layer.add_anchor(Anchor::new(Some("_top".to_string()), 0.0, 0.0));
        assert!(!glyph.has_attaching_anchor());

        let layer = glyph.ensure_layer_for_source(SourceId::new());
        layer.add_anchor(Anchor::new(None, 0.0, 0.0));

        assert!(glyph.has_attaching_anchor());
    }

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
        assert!(layer.contour(&id).is_some());
    }

    #[test]
    fn glyph_layer_anchors_are_ordered() {
        let mut layer = GlyphLayer::new(LayerId::new(), SourceId::new());
        let a1 = layer.add_anchor(Anchor::new(Some("top".to_string()), 10.0, 20.0));
        let a2 = layer.add_anchor(Anchor::new(Some("bottom".to_string()), 30.0, 40.0));

        let ids: Vec<_> = layer.anchors_iter().map(crate::Anchor::id).collect();
        assert_eq!(ids, vec![a1, a2]);
    }
}
