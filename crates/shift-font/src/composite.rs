//! Composite glyph resolution utilities.
//!
//! This module resolves component-based glyph layers into concrete contours for
//! render-time use (SVG path generation, bounding boxes, and snapshot overlays).
//! The resolver does not mutate glyph sources; it produces derived geometry.
//!
//! Anchor-driven placement rules:
//! - Primary attachment: a component anchor named `_{name}` attaches to the
//!   most recently placed anchor named `{name}`.
//! - Explicit component affine transforms are always applied; anchor offsets are
//!   composed on top of those transforms.
//!
//! Traversal and determinism rules:
//! - Components are processed in stable ID order (`ComponentId::raw`).
//! - Cycles are handled branch-locally: cyclic branches are skipped so
//!   non-cyclic branches still contribute geometry.

use crate::curve::segment_bounds;
use crate::{
    Contour, CurveSegment, CurveSegmentIter, Font, Glyph, GlyphId, GlyphLayer, Point, PointId,
    Transform,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Layer lookup abstraction used by the composite resolver.
///
/// Implementations can provide different visibility rules (for example,
/// session-local edited layers vs. persisted font layers).
pub trait GlyphLayerProvider {
    /// Returns the layer used for composite resolution for a given glyph id.
    fn glyph_layer(&self, glyph_id: &GlyphId) -> Option<&GlyphLayer>;

    /// Returns the current glyph name for display/provenance.
    fn glyph_name(&self, glyph_id: &GlyphId) -> Option<&str>;
}

/// [`GlyphLayerProvider`] that resolves layers directly from a [`Font`].
///
/// This provider selects each glyph's preferred layer via
/// [`preferred_layer_for_glyph`].
pub struct FontLayerProvider<'a> {
    font: &'a Font,
}

impl<'a> FontLayerProvider<'a> {
    /// Creates a provider backed by `font`.
    pub fn new(font: &'a Font) -> Self {
        Self { font }
    }
}

impl GlyphLayerProvider for FontLayerProvider<'_> {
    fn glyph_layer(&self, glyph_id: &GlyphId) -> Option<&GlyphLayer> {
        self.font
            .glyph(glyph_id.clone())
            .and_then(preferred_layer_for_glyph)
    }

    fn glyph_name(&self, glyph_id: &GlyphId) -> Option<&str> {
        self.font.glyph(glyph_id.clone()).map(Glyph::name)
    }
}

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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolvedComponentInstance {
    pub component_glyph_name: String,
    pub contours: Vec<ResolvedContour>,
}

#[derive(Clone)]
struct PlacedAnchor {
    name: String,
    x: f64,
    y: f64,
}

#[derive(Clone)]
struct AnchorOffset {
    dx: f64,
    dy: f64,
}

/// Heuristic complexity score used to choose a "primary" layer for rendering.
pub fn layer_complexity(layer: &GlyphLayer) -> usize {
    layer.contours().len() + layer.components().len()
}

/// Picks the layer with the highest render complexity.
///
/// Complexity is currently defined as `contours + components`.
pub fn preferred_layer_for_glyph(glyph: &Glyph) -> Option<&GlyphLayer> {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer_complexity(layer))
        .map(|layer| layer.as_ref())
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

/// Resolves primary anchor attachment offsets for a component.
///
/// A component anchor named `_{name}` is attached to the most recently placed
/// base anchor named `{name}`.
fn anchor_offset_for_component(
    component_layer: &GlyphLayer,
    component_transform: Transform,
    placed_anchors: &[PlacedAnchor],
) -> Option<AnchorOffset> {
    // Primary mark attachment:
    // `_top` in the component attaches to the most recently placed `top`.
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

        let Some(base_anchor) = placed_anchors.iter().rev().find(|a| a.name == target_name) else {
            continue;
        };

        let (ax, ay) = component_transform.transform_point(anchor.x(), anchor.y());
        return Some(AnchorOffset {
            dx: base_anchor.x - ax,
            dy: base_anchor.y - ay,
        });
    }

    None
}

/// Adds transformed component anchors to the placement stack.
///
/// Stack order is significant: later lookups prefer more recently placed
/// anchors, mirroring component evaluation order.
fn append_component_anchors(
    component_layer: &GlyphLayer,
    component_transform: Transform,
    placed_anchors: &mut Vec<PlacedAnchor>,
) {
    // Keep placement order so later attachment prefers the latest matching base
    // anchor, mirroring composite component evaluation order.
    for anchor in component_layer.anchors_iter() {
        let Some(name) = anchor.name() else {
            continue;
        };
        let (x, y) = component_transform.transform_point(anchor.x(), anchor.y());
        placed_anchors.push(PlacedAnchor {
            name: name.to_string(),
            x,
            y,
        });
    }
}

/// Resolves the final transform for a single component.
///
/// Precedence:
/// 1. explicit component transform,
/// 2. `_name` anchor attachment offset,
fn resolve_component_transform(
    provider: &impl GlyphLayerProvider,
    component_base_glyph_id: &GlyphId,
    explicit_transform: Transform,
    placed_anchors: &[PlacedAnchor],
) -> Transform {
    // Precedence:
    // 1) explicit component transform
    // 2) explicit + primary `_name` anchor attachment offset
    let Some(component_layer) = provider.glyph_layer(component_base_glyph_id) else {
        return explicit_transform;
    };

    let Some(offset) =
        anchor_offset_for_component(component_layer, explicit_transform, placed_anchors)
    else {
        return explicit_transform;
    };

    compose_transform(
        Transform::translate(offset.dx, offset.dy),
        explicit_transform,
    )
}

/// Recursively flattens contours for a glyph name into `out`.
///
/// Cycles are skipped branch-locally using `visiting`.
fn flatten_component_named(
    provider: &impl GlyphLayerProvider,
    glyph_id: &GlyphId,
    transform: Transform,
    visiting: &mut HashSet<GlyphId>,
    out: &mut Vec<ResolvedContour>,
) {
    // Branch-local cycle guard: skip only the cyclic branch.
    if !visiting.insert(glyph_id.clone()) {
        return;
    }

    if let Some(layer) = provider.glyph_layer(glyph_id) {
        for contour in layer.contours_iter() {
            out.push(transform_contour_points(contour, transform));
        }

        let mut placed_anchors = Vec::new();
        for component in layer.components_iter() {
            let explicit_transform = component.matrix();
            let component_transform = resolve_component_transform(
                provider,
                &component.base_glyph_id(),
                explicit_transform,
                &placed_anchors,
            );

            if let Some(component_layer) = provider.glyph_layer(&component.base_glyph_id()) {
                append_component_anchors(component_layer, component_transform, &mut placed_anchors);
            }

            flatten_component_named(
                provider,
                &component.base_glyph_id(),
                compose_transform(transform, component_transform),
                visiting,
                out,
            );
        }
    }

    visiting.remove(glyph_id);
}

/// Flattens all component contours for `layer`, rooted at `root_glyph_name`.
///
/// Root contours are not included in the returned value; only resolved
/// component contours are returned. Consumers that need full geometry should
/// combine root contours with this output.
///
/// Components are traversed in stable ID order, and cycles are skipped
/// branch-locally.
pub fn flatten_component_contours_for_layer(
    provider: &impl GlyphLayerProvider,
    layer: &GlyphLayer,
    root_glyph_id: &GlyphId,
) -> Vec<ResolvedContour> {
    resolve_component_instances_for_layer(provider, layer, root_glyph_id)
        .into_iter()
        .flat_map(|instance| instance.contours)
        .collect()
}

/// Resolves root and component contours for one derived glyph layer.
///
/// Root points receive fresh identities because the result is read-only
/// derived geometry. Components use the supplied provider and skip cyclic
/// branches without dropping other contours.
pub fn resolved_contours_for_layer(
    provider: &impl GlyphLayerProvider,
    layer: &GlyphLayer,
    root_glyph_id: &GlyphId,
) -> Vec<ResolvedContour> {
    let mut contours = layer
        .contours_iter()
        .map(|contour| transform_contour_points(contour, Transform::identity()))
        .collect::<Vec<_>>();
    contours.extend(flatten_component_contours_for_layer(
        provider,
        layer,
        root_glyph_id,
    ));
    contours
}

/// Resolves root-level component instances with provenance data.
///
/// Each returned instance corresponds to a direct component of `layer` and
/// contains:
/// - the component glyph name,
/// - flattened contours for that component branch (including nested components),
pub fn resolve_component_instances_for_layer(
    provider: &impl GlyphLayerProvider,
    layer: &GlyphLayer,
    root_glyph_id: &GlyphId,
) -> Vec<ResolvedComponentInstance> {
    let mut out = Vec::new();
    let mut visiting = HashSet::new();
    visiting.insert(root_glyph_id.clone());

    let mut placed_anchors = Vec::new();
    for component in layer.components_iter() {
        let explicit_transform = component.matrix();
        let component_transform = resolve_component_transform(
            provider,
            &component.base_glyph_id(),
            explicit_transform,
            &placed_anchors,
        );

        if let Some(component_layer) = provider.glyph_layer(&component.base_glyph_id()) {
            append_component_anchors(component_layer, component_transform, &mut placed_anchors);
        }

        let mut contours = Vec::new();
        flatten_component_named(
            provider,
            &component.base_glyph_id(),
            component_transform,
            &mut visiting,
            &mut contours,
        );

        out.push(ResolvedComponentInstance {
            component_glyph_name: provider
                .glyph_name(&component.base_glyph_id())
                .unwrap_or_else(|| component.base_glyph_name().as_str())
                .to_string(),
            contours,
        });
    }

    out
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
        let composite_layer_id = composite_layer.id();
        composite_layer.add_component(Component::new(base_id, "base".to_string()));
        composite.set_layer(composite_layer);
        font.insert_glyph(composite).unwrap();

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("comp")
            .and_then(|glyph| glyph.layer(composite_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &composite_id);

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].points.len(), 2);
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
        let a_layer_id = a_layer.id();
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

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("A")
            .and_then(|glyph| glyph.layer(a_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &a_id);

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
        let comp_layer_id = comp_layer.id();
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("comp")
            .and_then(|glyph| glyph.layer(comp_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &comp_id);

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
        let comp_layer_id = comp_layer.id();
        let matrix = Transform::translate(30.0, 40.0);
        comp_layer.add_component(Component::with_matrix(mark_id, "mark".to_string(), &matrix));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("comp")
            .and_then(|glyph| glyph.layer(comp_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &comp_id);

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
        let comp_layer_id = comp_layer.id();
        comp_layer.add_anchor(Anchor::new(Some("parent_top".to_string()), 0.0, 0.0));
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("comp")
            .and_then(|glyph| glyph.layer(comp_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &comp_id);

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
        let comp_layer_id = comp_layer.id();
        comp_layer.add_component(Component::new(base_id, "base".to_string()));
        comp_layer.add_component(Component::new(mark_id.clone(), "mark".to_string()));
        comp_layer.add_component(Component::new(mark_id, "mark".to_string()));
        comp.set_layer(comp_layer);
        font.insert_glyph(comp).unwrap();

        let provider = FontLayerProvider::new(&font);
        let layer = font
            .glyph_by_name("comp")
            .and_then(|glyph| glyph.layer(comp_layer_id))
            .unwrap();
        let resolved = flatten_component_contours_for_layer(&provider, layer, &comp_id);

        assert_eq!(resolved.len(), 3);
        let first_mark = &resolved[1];
        assert_eq!(first_mark.points[0].y(), 200.0);
        assert_eq!(first_mark.points[1].y(), 200.0);

        let second_mark = &resolved[2];
        assert_eq!(second_mark.points[0].y(), 220.0);
        assert_eq!(second_mark.points[1].y(), 220.0);
    }
}
