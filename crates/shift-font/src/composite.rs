//! Composite glyph resolution utilities.
//!
//! This module builds component relationships and resolves them into concrete
//! contours without mutating authored glyph layers.
//!
//! Anchor-driven placement rules:
//! - Primary attachment: a component anchor named `_{name}` attaches to the
//!   most recently placed anchor named `{name}`.
//! - Explicit component affine transforms are always applied; anchor offsets are
//!   composed on top of those transforms.
//!
//! Traversal and determinism rules:
//! - Components are processed in authored order.
//! - Cycles are handled branch-locally: cyclic branches are skipped so
//!   non-cyclic branches still contribute geometry.

use crate::curve::segment_bounds;
use crate::{
    Anchor, AnchorId, ComponentId, Contour, CoreError, CoreResult, CurveSegment, CurveSegmentIter,
    GlyphId, GlyphLayer, Point, PointId, Transform,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolvedContour {
    /// Resolved contour points after all component transforms/offsets.
    ///
    /// Point IDs are regenerated because these are derived render-time points,
    /// not editable source point identities.
    pub points: Vec<Point>,
    /// Whether the contour is closed.
    pub closed: bool,
}

/// Stable ancestry for one component occurrence.
///
/// IDs are ordered outermost to innermost. An empty path identifies the root
/// glyph rather than a component occurrence.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct ComponentPath(Vec<ComponentId>);

impl ComponentPath {
    /// Returns the ordered component identities in this ancestry.
    pub fn as_slice(&self) -> &[ComponentId] {
        &self.0
    }

    fn child(&self, component_id: ComponentId) -> Self {
        let mut ids = self.0.clone();
        ids.push(component_id);
        Self(ids)
    }

    fn is_root(&self) -> bool {
        self.0.is_empty()
    }
}

/// One anchor occurrence within cycle-pruned component relationships.
///
/// `component_path` is empty only for a root glyph anchor. Component placement
/// currently references sibling occurrences, so projected attachment anchors
/// normally carry the path of the direct component that contributes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentAnchorReference {
    component_path: ComponentPath,
    glyph_id: GlyphId,
    anchor_id: AnchorId,
}

impl ComponentAnchorReference {
    /// Returns the component occurrence that owns the anchor.
    pub fn component_path(&self) -> &ComponentPath {
        &self.component_path
    }

    /// Returns the glyph whose selected layer contains the anchor.
    pub fn glyph_id(&self) -> GlyphId {
        self.glyph_id.clone()
    }

    /// Returns the stable anchor identity within the selected glyph layer.
    pub fn anchor_id(&self) -> AnchorId {
        self.anchor_id.clone()
    }
}

/// Rust-selected anchor attachment for one component occurrence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentAnchorAttachment {
    source: ComponentAnchorReference,
    target: ComponentAnchorReference,
}

impl ComponentAnchorAttachment {
    /// Returns the `_name` anchor on the component being placed.
    pub fn source(&self) -> &ComponentAnchorReference {
        &self.source
    }

    /// Returns the most recently placed matching `name` anchor.
    pub fn target(&self) -> &ComponentAnchorReference {
        &self.target
    }
}

/// One ordered component occurrence within a glyph.
///
/// The occurrence is already cycle-pruned. Consumers evaluate its authored
/// transform relative to `parent_path`, then apply the optional Rust-selected
/// anchor attachment. They do not repeat name matching, ordering, or cycle
/// decisions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentGlyph {
    parent_glyph_id: GlyphId,
    component_id: ComponentId,
    base_glyph_id: GlyphId,
    parent_path: ComponentPath,
    component_path: ComponentPath,
    attachment: Option<ComponentAnchorAttachment>,
}

impl ComponentGlyph {
    /// Returns the glyph layer that owns the component transform.
    pub fn parent_glyph_id(&self) -> GlyphId {
        self.parent_glyph_id.clone()
    }

    /// Returns the stable component identity within its parent layer.
    pub fn component_id(&self) -> ComponentId {
        self.component_id.clone()
    }

    /// Returns the glyph instantiated by this component occurrence.
    pub fn base_glyph_id(&self) -> GlyphId {
        self.base_glyph_id.clone()
    }

    /// Returns the parent component occurrence, or an empty path for the root.
    pub fn parent_path(&self) -> &ComponentPath {
        &self.parent_path
    }

    /// Returns the unique ancestry path for this component occurrence.
    pub fn component_path(&self) -> &ComponentPath {
        &self.component_path
    }

    /// Returns the Rust-selected anchor attachment, when one applies.
    pub fn attachment(&self) -> Option<&ComponentAnchorAttachment> {
        self.attachment.as_ref()
    }
}

/// Ordered, cycle-pruned component relationships for one resolved root glyph.
///
/// Every referenced glyph has already been resolved at the root view location.
/// Missing authored layers at that location are therefore represented by the
/// referenced glyph's interpolation or static master shape, never by omission.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GlyphComponents {
    root_glyph_id: GlyphId,
    components: Vec<ComponentGlyph>,
}

impl GlyphComponents {
    /// Builds component relationships from layers resolved at one location.
    ///
    /// The result fixes authored order, `_name` attachment choice, occurrence
    /// paths, and branch-local cycle pruning without snapshotting numeric
    /// transforms or anchor positions.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::UnresolvableComponentGlyph`] when a referenced
    /// glyph is absent from `layers`. Callers must resolve the complete
    /// transitive component closure at one location before invoking this
    /// function.
    pub fn from_layers(
        root_glyph_id: &GlyphId,
        layers: &HashMap<GlyphId, GlyphLayer>,
    ) -> CoreResult<Self> {
        let root_layer = layer_for_glyph(layers, root_glyph_id)?;
        let mut components = Vec::new();
        let mut visiting = HashSet::from([root_glyph_id.clone()]);
        append_components(
            layers,
            root_layer,
            root_glyph_id,
            &ComponentPath::default(),
            &mut visiting,
            &mut components,
        )?;
        Ok(Self {
            root_glyph_id: root_glyph_id.clone(),
            components,
        })
    }

    /// Returns the glyph whose component relationships are represented.
    pub fn root_glyph_id(&self) -> GlyphId {
        self.root_glyph_id.clone()
    }

    /// Returns component occurrences in parent-before-child evaluation order.
    pub fn components(&self) -> &[ComponentGlyph] {
        &self.components
    }
}

fn layer_for_glyph<'a>(
    layers: &'a HashMap<GlyphId, GlyphLayer>,
    glyph_id: &GlyphId,
) -> CoreResult<&'a GlyphLayer> {
    layers
        .get(glyph_id)
        .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))
}

fn layer_for_component<'a>(
    layers: &'a HashMap<GlyphId, GlyphLayer>,
    component_id: &ComponentId,
    base_glyph_id: &GlyphId,
) -> CoreResult<&'a GlyphLayer> {
    layers
        .get(base_glyph_id)
        .ok_or_else(|| CoreError::UnresolvableComponentGlyph {
            component_id: component_id.clone(),
            base_glyph_id: base_glyph_id.clone(),
        })
}

fn invalid_component(component: &ComponentGlyph) -> CoreError {
    CoreError::InvalidComponentId(component.component_id().to_string())
}

trait NamedPlacedAnchor {
    fn name(&self) -> &str;
}

fn attachment_anchor_pair<'a, T: NamedPlacedAnchor>(
    component_layer: &'a GlyphLayer,
    placed_anchors: &'a [T],
) -> Option<(&'a Anchor, &'a T)> {
    for anchor in component_layer.anchors_iter() {
        let Some(name) = anchor.name() else {
            continue;
        };
        let Some(target_name) = name.strip_prefix('_') else {
            continue;
        };
        if target_name.is_empty() {
            continue;
        }

        if let Some(target) = placed_anchors
            .iter()
            .rev()
            .find(|placed| placed.name() == target_name)
        {
            return Some((anchor, target));
        }
    }

    None
}

fn transform_contour_points(contour: &Contour, transform: Transform) -> ResolvedContour {
    let points = contour
        .points()
        .iter()
        .map(|point| {
            let (x, y) = transform.transform_point(point.x(), point.y());
            Point::new(PointId::new(), x, y, point.point_type(), point.is_smooth())
        })
        .collect();

    ResolvedContour {
        points,
        closed: contour.is_closed(),
    }
}

#[derive(Clone)]
struct PlacedComponentAnchor {
    name: String,
    anchor: ComponentAnchorReference,
}

impl NamedPlacedAnchor for PlacedComponentAnchor {
    fn name(&self) -> &str {
        &self.name
    }
}

fn append_components(
    layers: &HashMap<GlyphId, GlyphLayer>,
    parent_layer: &GlyphLayer,
    parent_glyph_id: &GlyphId,
    parent_path: &ComponentPath,
    visiting: &mut HashSet<GlyphId>,
    out: &mut Vec<ComponentGlyph>,
) -> CoreResult<()> {
    let mut placed_anchors: Vec<PlacedComponentAnchor> = Vec::new();

    for component in parent_layer.components_iter() {
        let base_glyph_id = component.base_glyph_id();
        if visiting.contains(&base_glyph_id) {
            continue;
        }

        let component_layer = layer_for_component(layers, &component.id(), &base_glyph_id)?;

        let component_path = parent_path.child(component.id());
        let attachment =
            attachment_anchor_pair(component_layer, &placed_anchors).map(|(source, target)| {
                ComponentAnchorAttachment {
                    source: ComponentAnchorReference {
                        component_path: component_path.clone(),
                        glyph_id: base_glyph_id.clone(),
                        anchor_id: source.id(),
                    },
                    target: target.anchor.clone(),
                }
            });

        out.push(ComponentGlyph {
            parent_glyph_id: parent_glyph_id.clone(),
            component_id: component.id(),
            base_glyph_id: base_glyph_id.clone(),
            parent_path: parent_path.clone(),
            component_path: component_path.clone(),
            attachment,
        });

        for anchor in component_layer.anchors_iter() {
            let Some(name) = anchor.name() else {
                continue;
            };

            placed_anchors.push(PlacedComponentAnchor {
                name: name.to_string(),
                anchor: ComponentAnchorReference {
                    component_path: component_path.clone(),
                    glyph_id: base_glyph_id.clone(),
                    anchor_id: anchor.id(),
                },
            });
        }

        visiting.insert(base_glyph_id.clone());
        append_components(
            layers,
            component_layer,
            &base_glyph_id,
            &component_path,
            visiting,
            out,
        )?;
        visiting.remove(&base_glyph_id);
    }

    Ok(())
}

fn explicit_transform_for_component(
    layers: &HashMap<GlyphId, GlyphLayer>,
    component_glyph: &ComponentGlyph,
) -> CoreResult<Transform> {
    let parent_layer = layer_for_glyph(layers, &component_glyph.parent_glyph_id())?;
    let component = parent_layer
        .components_iter()
        .find(|component| component.id() == component_glyph.component_id())
        .ok_or_else(|| invalid_component(component_glyph))?;
    if component.base_glyph_id() != component_glyph.base_glyph_id() {
        return Err(invalid_component(component_glyph));
    }

    Ok(component.matrix())
}

fn anchor_for_reference<'a>(
    layers: &'a HashMap<GlyphId, GlyphLayer>,
    reference: &ComponentAnchorReference,
) -> CoreResult<&'a Anchor> {
    let layer = layer_for_glyph(layers, &reference.glyph_id())?;
    layer
        .anchors_iter()
        .find(|anchor| anchor.id() == reference.anchor_id())
        .ok_or_else(|| CoreError::AnchorNotFound(reference.anchor_id()))
}

fn local_transform_for_component(
    layers: &HashMap<GlyphId, GlyphLayer>,
    component_glyph: &ComponentGlyph,
    local_transforms: &HashMap<ComponentPath, Transform>,
) -> CoreResult<Transform> {
    let explicit = explicit_transform_for_component(layers, component_glyph)?;
    let Some(attachment) = component_glyph.attachment() else {
        return Ok(explicit);
    };
    let source_anchor = anchor_for_reference(layers, attachment.source())?;
    let target_anchor = anchor_for_reference(layers, attachment.target())?;
    let target_transform = local_transforms
        .get(attachment.target().component_path())
        .ok_or_else(|| invalid_component(component_glyph))?;

    let (source_x, source_y) = explicit.transform_point(source_anchor.x(), source_anchor.y());
    let (target_x, target_y) =
        target_transform.transform_point(target_anchor.x(), target_anchor.y());
    Ok(compose_transform(
        Transform::translate(target_x - source_x, target_y - source_y),
        explicit,
    ))
}

fn resolve_component_contours(
    layers: &HashMap<GlyphId, GlyphLayer>,
    components: &GlyphComponents,
) -> CoreResult<Vec<ResolvedContour>> {
    let mut local_transforms = HashMap::<ComponentPath, Transform>::new();
    let mut resolved_transforms = HashMap::<ComponentPath, Transform>::new();
    let mut contours = Vec::new();

    for component_glyph in components.components() {
        let local_transform =
            local_transform_for_component(layers, component_glyph, &local_transforms)?;
        let parent_transform = if component_glyph.parent_path().is_root() {
            Transform::identity()
        } else {
            *resolved_transforms
                .get(component_glyph.parent_path())
                .ok_or_else(|| invalid_component(component_glyph))?
        };
        let resolved_transform = compose_transform(parent_transform, local_transform);
        local_transforms.insert(component_glyph.component_path().clone(), local_transform);
        resolved_transforms.insert(component_glyph.component_path().clone(), resolved_transform);

        let layer = layer_for_component(
            layers,
            &component_glyph.component_id(),
            &component_glyph.base_glyph_id(),
        )?;
        contours.extend(
            layer
                .contours_iter()
                .map(|contour| transform_contour_points(contour, resolved_transform)),
        );
    }

    Ok(contours)
}

/// Flattens all component contours rooted at `root_glyph_id`.
///
/// Root contours are not included in the returned value; only resolved
/// component contours are returned. Consumers that need full geometry should
/// combine root contours with this output.
///
/// Components retain authored order, and cyclic branches are absent from the
/// authoritative relationships used for numeric resolution.
///
/// # Errors
///
/// Returns an error when `layers` does not contain the complete component
/// closure or when its component and anchor identities are inconsistent.
pub fn flatten_component_contours_from_layers(
    root_glyph_id: &GlyphId,
    layers: &HashMap<GlyphId, GlyphLayer>,
) -> CoreResult<Vec<ResolvedContour>> {
    let components = GlyphComponents::from_layers(root_glyph_id, layers)?;
    resolve_component_contours(layers, &components)
}

/// Resolves root and component contours for one derived glyph layer.
///
/// Root points receive fresh identities because the result is read-only
/// derived geometry. Components use the supplied resolved layers and skip
/// cyclic branches without dropping other contours.
///
/// # Errors
///
/// Returns an error when `layers` does not contain the root or its complete
/// component closure, or when component and anchor identities are inconsistent.
pub fn resolved_contours_from_layers(
    root_glyph_id: &GlyphId,
    layers: &HashMap<GlyphId, GlyphLayer>,
) -> CoreResult<Vec<ResolvedContour>> {
    let layer = layer_for_glyph(layers, root_glyph_id)?;
    let mut contours = layer
        .contours_iter()
        .map(|contour| transform_contour_points(contour, Transform::identity()))
        .collect::<Vec<_>>();
    contours.extend(flatten_component_contours_from_layers(
        root_glyph_id,
        layers,
    )?);
    Ok(contours)
}

/// Builds a single SVG path string from root contours and resolved component
/// contours.
pub fn layer_to_svg_path(layer: &GlyphLayer, component_contours: &[ResolvedContour]) -> String {
    let mut parts = Vec::new();
    for contour in layer.contours_iter() {
        let d = contour_to_svg_d(contour.points(), contour.is_closed());
        if !d.is_empty() {
            parts.push(d);
        }
    }
    for contour in component_contours {
        let d = contour_to_svg_d(&contour.points, contour.closed);
        if !d.is_empty() {
            parts.push(d);
        }
    }
    parts.join(" ")
}

/// Builds one SVG path string from already resolved contours in font units.
///
/// Empty contours and contours without drawable segments are omitted. An empty
/// result therefore represents a present blank glyph, not a missing glyph.
pub fn resolved_contours_to_svg_path(contours: &[ResolvedContour]) -> String {
    contours
        .iter()
        .filter_map(|contour| {
            let path = contour_to_svg_d(&contour.points, contour.closed);
            (!path.is_empty()).then_some(path)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn accumulate_contour_bbox(
    points: &[Point],
    closed: bool,
    min_x: &mut f64,
    min_y: &mut f64,
    max_x: &mut f64,
    max_y: &mut f64,
    any: &mut bool,
) {
    for segment in CurveSegmentIter::new(points, closed) {
        let (sx, sy, ex, ey) = segment_bounds(&segment);
        *min_x = min_x.min(sx);
        *min_y = min_y.min(sy);
        *max_x = max_x.max(ex);
        *max_y = max_y.max(ey);
        *any = true;
    }
}

/// Computes a tight axis-aligned bounding box across root and component
/// contours.
///
/// Returns `(min_x, min_y, max_x, max_y)` or `None` if no segments exist.
pub fn layer_bbox(
    layer: &GlyphLayer,
    component_contours: &[ResolvedContour],
) -> Option<(f64, f64, f64, f64)> {
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    let mut any = false;

    for contour in layer.contours_iter() {
        accumulate_contour_bbox(
            contour.points(),
            contour.is_closed(),
            &mut min_x,
            &mut min_y,
            &mut max_x,
            &mut max_y,
            &mut any,
        );
    }

    for contour in component_contours {
        accumulate_contour_bbox(
            &contour.points,
            contour.closed,
            &mut min_x,
            &mut min_y,
            &mut max_x,
            &mut max_y,
            &mut any,
        );
    }

    if any {
        Some((min_x, min_y, max_x, max_y))
    } else {
        None
    }
}

fn contour_to_svg_d(points: &[Point], closed: bool) -> String {
    if points.len() < 2 {
        return String::new();
    }

    let mut out = Vec::new();
    let mut first = true;

    for seg in CurveSegmentIter::new(points, closed) {
        match seg {
            CurveSegment::Line(p1, p2) => {
                if first {
                    out.push(format!("M {} {}", p1.x(), p1.y()));
                    first = false;
                }
                out.push(format!("L {} {}", p2.x(), p2.y()));
            }
            CurveSegment::Quad(p1, cp, p2) => {
                if first {
                    out.push(format!("M {} {}", p1.x(), p1.y()));
                    first = false;
                }
                out.push(format!("Q {} {} {} {}", cp.x(), cp.y(), p2.x(), p2.y()));
            }
            CurveSegment::Cubic(p1, cp1, cp2, p2) => {
                if first {
                    out.push(format!("M {} {}", p1.x(), p1.y()));
                    first = false;
                }
                out.push(format!(
                    "C {} {} {} {} {} {}",
                    cp1.x(),
                    cp1.y(),
                    cp2.x(),
                    cp2.y(),
                    p2.x(),
                    p2.y()
                ));
            }
        }
    }

    if closed && !out.is_empty() {
        out.push("Z".to_string());
    }
    out.join(" ")
}

/// Composes transforms as `outer ∘ inner` (apply `inner`, then `outer`).
fn compose_transform(outer: Transform, inner: Transform) -> Transform {
    Transform {
        xx: outer.xx * inner.xx + outer.yx * inner.xy,
        xy: outer.xy * inner.xx + outer.yy * inner.xy,
        yx: outer.xx * inner.yx + outer.yx * inner.yy,
        yy: outer.xy * inner.yx + outer.yy * inner.yy,
        dx: outer.xx * inner.dx + outer.yx * inner.dy + outer.dx,
        dy: outer.xy * inner.dx + outer.yy * inner.dy + outer.dy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Anchor, Component, Contour, Font, Glyph, GlyphId, GlyphLayer, LayerId, PointType, SourceId,
        Transform,
    };

    fn two_point_contour(x0: f64, y0: f64, x1: f64, y1: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(x0, y0, PointType::OnCurve, false);
        contour.add_point(x1, y1, PointType::OnCurve, false);
        contour
    }

    fn test_layer(source_id: SourceId, width: f64) -> GlyphLayer {
        GlyphLayer::with_width(LayerId::new(), source_id, width)
    }

    fn default_layers(font: &Font) -> HashMap<GlyphId, GlyphLayer> {
        let source_id = font.default_source_id().unwrap();
        font.glyphs()
            .filter_map(|glyph| {
                glyph
                    .layer_for_source(source_id.clone())
                    .map(|layer| (glyph.id(), layer.clone()))
            })
            .collect()
    }

    #[test]
    fn flatten_includes_component_contours() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut base = Glyph::new("base".to_string());
        let base_id = base.id();
        let mut base_layer = test_layer(source_id.clone(), 500.0);
        base_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 10.0));
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let mut composite = Glyph::new("comp".to_string());
        let composite_id = composite.id();
        let mut composite_layer = test_layer(source_id.clone(), 500.0);
        composite_layer.add_component(Component::new(base_id, "base".to_string()));
        composite.set_layer(composite_layer);
        font.insert_glyph(composite).unwrap();

        let resolved =
            flatten_component_contours_from_layers(&composite_id, &default_layers(&font)).unwrap();

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].points.len(), 2);
    }

    #[test]
    fn component_paths_distinguish_repeated_nested_occurrences() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut base = Glyph::new("base".to_string());
        let base_id = base.id();
        base.set_layer(test_layer(source_id.clone(), 500.0));
        font.insert_glyph(base).unwrap();

        let mut middle = Glyph::new("middle".to_string());
        let middle_id = middle.id();
        let mut middle_layer = test_layer(source_id.clone(), 500.0);
        let nested_id = middle_layer.add_component(Component::new(base_id, "base".to_string()));
        middle.set_layer(middle_layer);
        font.insert_glyph(middle).unwrap();

        let mut root = Glyph::new("root".to_string());
        let root_id = root.id();
        let mut root_layer = test_layer(source_id, 500.0);
        let first_id =
            root_layer.add_component(Component::new(middle_id.clone(), "middle".to_string()));
        let second_id = root_layer.add_component(Component::new(middle_id, "middle".to_string()));
        root.set_layer(root_layer);
        font.insert_glyph(root).unwrap();

        let components = GlyphComponents::from_layers(&root_id, &default_layers(&font)).unwrap();
        let paths = components
            .components()
            .iter()
            .map(|component| component.component_path().as_slice().to_vec())
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            vec![
                vec![first_id.clone()],
                vec![first_id, nested_id.clone()],
                vec![second_id.clone()],
                vec![second_id, nested_id],
            ]
        );
    }

    #[test]
    fn flatten_skips_cycle_and_keeps_other_branches() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut a = Glyph::new("A".to_string());
        let a_id = a.id();
        let b_id = GlyphId::new();
        let c_id = GlyphId::new();
        let mut a_layer = test_layer(source_id.clone(), 500.0);
        a_layer.add_component(Component::new(b_id.clone(), "B".to_string()));
        a_layer.add_component(Component::new(c_id.clone(), "C".to_string()));
        a.set_layer(a_layer);
        font.insert_glyph(a).unwrap();

        let mut b = Glyph::with_id(b_id, "B".to_string());
        let mut b_layer = test_layer(source_id.clone(), 500.0);
        b_layer.add_contour(two_point_contour(0.0, 0.0, 20.0, 20.0));
        b_layer.add_component(Component::new(a_id.clone(), "A".to_string()));
        b.set_layer(b_layer);
        font.insert_glyph(b).unwrap();

        let mut c = Glyph::with_id(c_id, "C".to_string());
        let mut c_layer = test_layer(source_id.clone(), 500.0);
        c_layer.add_contour(two_point_contour(10.0, 0.0, 30.0, 20.0));
        c.set_layer(c_layer);
        font.insert_glyph(c).unwrap();

        let resolved =
            flatten_component_contours_from_layers(&a_id, &default_layers(&font)).unwrap();

        assert_eq!(resolved.len(), 2);
    }

    #[test]
    fn primary_anchor_attachment_applies_translation() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut base = Glyph::new("base".to_string());
        let base_id = base.id();
        let mut base_layer = test_layer(source_id.clone(), 500.0);
        base_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        base_layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 200.0));
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let mut mark = Glyph::new("mark".to_string());
        let mark_id = mark.id();
        let mut mark_layer = test_layer(source_id.clone(), 500.0);
        mark_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        mark_layer.add_anchor(Anchor::new(Some("_top".to_string()), 5.0, 0.0));
        mark.set_layer(mark_layer);
        font.insert_glyph(mark).unwrap();

        let mut comp = Glyph::new("comp".to_string());
        let comp_id = comp.id();
        let mut comp_layer = test_layer(source_id.clone(), 500.0);
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let layers = default_layers(&font);
        let components = GlyphComponents::from_layers(&comp_id, &layers).unwrap();
        let attachment = components.components()[1].attachment().unwrap();

        assert_eq!(
            attachment.source().component_path(),
            components.components()[1].component_path()
        );
        assert_eq!(
            attachment.target().component_path(),
            components.components()[0].component_path()
        );

        let resolved = flatten_component_contours_from_layers(&comp_id, &layers).unwrap();

        assert_eq!(resolved.len(), 2);
        let mark_contour = &resolved[1];
        assert_eq!(mark_contour.points[0].x(), 95.0);
        assert_eq!(mark_contour.points[0].y(), 200.0);
        assert_eq!(mark_contour.points[1].x(), 105.0);
        assert_eq!(mark_contour.points[1].y(), 200.0);
    }

    #[test]
    fn explicit_transform_applies_without_attachment() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut mark = Glyph::new("mark".to_string());
        let mark_id = mark.id();
        let mut mark_layer = test_layer(source_id.clone(), 500.0);
        mark_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        mark_layer.add_anchor(Anchor::new(Some("top".to_string()), 5.0, 0.0));
        mark.set_layer(mark_layer);
        font.insert_glyph(mark).unwrap();

        let mut comp = Glyph::new("comp".to_string());
        let comp_id = comp.id();
        let mut comp_layer = test_layer(source_id.clone(), 500.0);
        let matrix = Transform::translate(30.0, 40.0);
        comp_layer.add_component(Component::with_matrix(mark_id, "mark".to_string(), &matrix));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let resolved =
            flatten_component_contours_from_layers(&comp_id, &default_layers(&font)).unwrap();

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].points[0].x(), 30.0);
        assert_eq!(resolved[0].points[0].y(), 40.0);
        assert_eq!(resolved[0].points[1].x(), 40.0);
        assert_eq!(resolved[0].points[1].y(), 40.0);
    }

    #[test]
    fn parent_anchor_hints_do_not_affect_component_placement() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut base = Glyph::new("base".to_string());
        let base_id = base.id();
        let mut base_layer = test_layer(source_id.clone(), 500.0);
        base_layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 200.0));
        base_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let mut mark = Glyph::new("mark".to_string());
        let mark_id = mark.id();
        let mut mark_layer = test_layer(source_id.clone(), 500.0);
        mark_layer.add_anchor(Anchor::new(Some("top_extra".to_string()), 5.0, 0.0));
        mark_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        mark.set_layer(mark_layer);
        font.insert_glyph(mark).unwrap();

        let mut comp = Glyph::new("comp".to_string());
        let comp_id = comp.id();
        let mut comp_layer = test_layer(source_id.clone(), 500.0);
        comp_layer.add_anchor(Anchor::new(Some("parent_top".to_string()), 0.0, 0.0));
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let resolved =
            flatten_component_contours_from_layers(&comp_id, &default_layers(&font)).unwrap();

        assert_eq!(resolved.len(), 2);
        let mark_contour = &resolved[1];
        assert_eq!(mark_contour.points[0].x(), 0.0);
        assert_eq!(mark_contour.points[0].y(), 0.0);
        assert_eq!(mark_contour.points[1].x(), 10.0);
        assert_eq!(mark_contour.points[1].y(), 0.0);
    }

    #[test]
    fn multiple_marks_attach_to_latest_matching_anchor() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        let mut base = Glyph::new("base".to_string());
        let base_id = base.id();
        let mut base_layer = test_layer(source_id.clone(), 500.0);
        base_layer.add_anchor(Anchor::new(Some("top".to_string()), 100.0, 200.0));
        base_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        base.set_layer(base_layer);
        font.insert_glyph(base).unwrap();

        let mut mark = Glyph::new("mark".to_string());
        let mark_id = mark.id();
        let mut mark_layer = test_layer(source_id.clone(), 500.0);
        mark_layer.add_anchor(Anchor::new(Some("_top".to_string()), 5.0, 0.0));
        mark_layer.add_anchor(Anchor::new(Some("top".to_string()), 5.0, 20.0));
        mark_layer.add_contour(two_point_contour(0.0, 0.0, 10.0, 0.0));
        mark.set_layer(mark_layer);
        font.insert_glyph(mark).unwrap();

        let mut comp = Glyph::new("comp".to_string());
        let comp_id = comp.id();
        let mut comp_layer = test_layer(source_id.clone(), 500.0);
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id.clone(), "mark".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let resolved =
            flatten_component_contours_from_layers(&comp_id, &default_layers(&font)).unwrap();

        assert_eq!(resolved.len(), 3);
        let first_mark = &resolved[1];
        assert_eq!(first_mark.points[0].y(), 200.0);
        assert_eq!(first_mark.points[1].y(), 200.0);

        let second_mark = &resolved[2];
        assert_eq!(second_mark.points[0].y(), 220.0);
        assert_eq!(second_mark.points[1].y(), 220.0);
    }
}
