//! Ink and skeleton bounds of a layer contour selection (M9).

use std::collections::HashSet;

use crate::composite::{ResolvedContour, resolved_contours_bbox};
use crate::ir::Transform;
use crate::{ContourId, CoreError, CoreResult, Font, GlyphLayer, LayerId};

use super::exact_offset::DEFAULT_TOLERANCE;
use super::ink::{LayerExtent, LayerExtentFallback, Measure, MeasureBounds, union_bounds};
use super::ink_fit::{InkBoxEdge, InkEdgeFitRequest, InkEdgeFitResult, fit_ink_edge};
use super::solve_cache::StrokeOutlineCache;

/// Which box edge a transform resize or fit targets over ink.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum InkBoundEdge {
    Left,
    Right,
    Top,
    Bottom,
}

impl From<InkBoundEdge> for InkBoxEdge {
    fn from(edge: InkBoundEdge) -> Self {
        match edge {
            InkBoundEdge::Left => Self::Left,
            InkBoundEdge::Right => Self::Right,
            InkBoundEdge::Top => Self::Top,
            InkBoundEdge::Bottom => Self::Bottom,
        }
    }
}

/// Whether a bounds read measures the whole layer or a contour subset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectionExtentFilter {
    WholeLayer,
    Contours(Vec<ContourId>),
}

impl Font {
    /// Bounds of `layer_id` for a whole layer or selected contours under the
    /// font's current metrics measure.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when the layer is missing and the
    /// font's error when the extent cannot be resolved.
    pub fn selection_extent(
        &self,
        layer_id: LayerId,
        filter: SelectionExtentFilter,
    ) -> CoreResult<LayerExtent> {
        match &filter {
            SelectionExtentFilter::WholeLayer => self.layer_extent(layer_id),
            SelectionExtentFilter::Contours(contour_ids) => {
                let measure = self.metrics_measure();
                let contour_ids = contour_ids.clone();
                self.ink_measure_runtime().with_extent_memo(|memo| {
                    memo.extent(self, layer_id, filter, measure, DEFAULT_TOLERANCE, || {
                        self.contour_set_extent(layer_id, &contour_ids)
                    })
                })
            }
        }
    }

    fn contour_set_extent(
        &self,
        layer_id: LayerId,
        contour_ids: &[ContourId],
    ) -> CoreResult<LayerExtent> {
        if contour_ids.is_empty() {
            return Err(CoreError::StrokeOperationFailed {
                message: "contour selection is empty".to_string(),
            });
        }

        let layer = self.require_layer(layer_id)?;
        let selection: HashSet<_> = contour_ids.iter().cloned().collect();
        let skeleton_contours = skeleton_contours_for_selection(layer, &selection);
        let skeleton = measure_bounds_of_contours(&skeleton_contours);

        let has_live_stroke = contour_ids.iter().any(|id| {
            layer
                .live_stroke_contour_ids()
                .iter()
                .any(|live| live == id)
        });

        let ignore = self.metrics_measure() == Measure::Skeleton;
        if ignore || !has_live_stroke {
            let fallback = self
                .ignore_stroke_in_metrics()
                .then_some(LayerExtentFallback::IgnoreStroke);
            return Ok(extent_from_parts(
                skeleton,
                None,
                Measure::Skeleton,
                fallback,
            ));
        }

        let ink_result = self.ink_measure_runtime().with_stroke_cache(|cache| {
            contour_set_ink_bounds(layer, &selection, cache, DEFAULT_TOLERANCE)
        });

        match ink_result {
            Ok(ink_bounds) => Ok(extent_from_parts(
                skeleton,
                Some(ink_bounds),
                Measure::Ink,
                None,
            )),
            Err(failure) => Ok(extent_from_parts(
                skeleton,
                None,
                Measure::Skeleton,
                Some(LayerExtentFallback::StrokeCouldNotBeSolved {
                    message: failure.message,
                }),
            )),
        }
    }
}

fn extent_from_parts(
    skeleton: MeasureBounds,
    ink: Option<MeasureBounds>,
    effective: Measure,
    fallback: Option<LayerExtentFallback>,
) -> LayerExtent {
    let active = if effective == Measure::Ink {
        ink.unwrap_or(skeleton)
    } else {
        skeleton
    };
    LayerExtent {
        min_x: active.min_x,
        min_y: active.min_y,
        max_x: active.max_x,
        max_y: active.max_y,
        skeleton,
        ink,
        effective,
        fallback,
    }
}

fn measure_bounds_of_contours(contours: &[ResolvedContour]) -> MeasureBounds {
    resolved_contours_bbox(contours).map_or(
        MeasureBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        },
        MeasureBounds::from,
    )
}

fn skeleton_contours_for_selection(
    layer: &GlyphLayer,
    selection: &HashSet<ContourId>,
) -> Vec<ResolvedContour> {
    layer
        .contours_iter()
        .filter(|contour| selection.contains(&contour.id()))
        .map(|contour| ResolvedContour::transformed(contour, Transform::identity()))
        .collect()
}

#[derive(Debug)]
struct InkSolveFailure {
    message: String,
}

fn contour_set_ink_bounds(
    layer: &GlyphLayer,
    selection: &HashSet<ContourId>,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> Result<MeasureBounds, InkSolveFailure> {
    let stroke_read = layer
        .stroke_outline_points_for_preview_with(tolerance, cache)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?;

    for failure in &stroke_read.failed {
        if selection.contains(&failure.skeleton_contour_id) {
            return Err(InkSolveFailure {
                message: failure.error.to_string(),
            });
        }
    }

    let live: HashSet<_> = layer.live_stroke_contour_ids().into_iter().collect();
    let mut bounds: Option<(f64, f64, f64, f64)> = None;

    // Solved bounds were measured at solve time; union them instead of
    // re-measuring every outline point on every read.
    for item in &stroke_read.solved {
        if !selection.contains(&item.skeleton_contour_id) {
            continue;
        }
        bounds = union_bounds(bounds, Some(item.bounds));
    }

    for contour in layer.contours_iter() {
        let contour_id = contour.id();
        if !selection.contains(&contour_id) || live.contains(&contour_id) {
            continue;
        }
        let resolved = ResolvedContour::transformed(contour, Transform::identity());
        bounds = union_bounds(
            bounds,
            resolved_contours_bbox(std::slice::from_ref(&resolved)),
        );
    }

    bounds
        .map(MeasureBounds::from)
        .ok_or_else(|| InkSolveFailure {
            message: "selection has no outline to measure".to_string(),
        })
}

/// Scales selected contours about the opposite edge so an ink edge lands on
/// `target`, as one layer intent.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct FitInkBound {
    pub layer_id: LayerId,
    pub contour_ids: Vec<ContourId>,
    pub edge: InkBoundEdge,
    pub target: f64,
}

/// Applies [`FitInkBound`]: fit then scale the selection skeleton.
///
/// # Errors
///
/// See [`InkEdgeFitError`] and [`CoreError::StrokeOperationFailed`].
pub fn apply_fit_ink_bound(font: &mut Font, intent: &FitInkBound) -> CoreResult<()> {
    let FitInkBound {
        layer_id,
        contour_ids,
        edge,
        target,
    } = intent;
    let request = InkEdgeFitRequest {
        layer_id: *layer_id,
        contour_ids: contour_ids.clone(),
        edge: (*edge).into(),
        target: *target,
        tolerance: DEFAULT_TOLERANCE,
    };
    let fit = fit_ink_edge(font, request).map_err(|error| CoreError::StrokeOperationFailed {
        message: error.to_string(),
    })?;
    apply_ink_fit_scale(font, *layer_id, contour_ids, (*edge).into(), fit)
}

fn apply_ink_fit_scale(
    font: &mut Font,
    layer_id: LayerId,
    contour_ids: &[ContourId],
    edge: InkBoxEdge,
    fit: InkEdgeFitResult,
) -> CoreResult<()> {
    if (fit.scale - 1.0).abs() <= f64::EPSILON {
        return Ok(());
    }

    let selection: HashSet<_> = contour_ids.iter().cloned().collect();
    let layer = font.require_layer(layer_id)?;
    let (min_x, min_y, max_x, max_y) = skeleton_bounds_of_contours(layer, &selection)?;
    let anchor = anchor_for_opposite_edge(edge, min_x, min_y, max_x, max_y);

    let mut layer = font.require_layer(layer_id)?.clone();
    scale_contours_about_anchor(&mut layer, &selection, edge, anchor, fit.scale);
    font.replace_glyph_layers(vec![layer])
}

fn skeleton_bounds_of_contours(
    layer: &GlyphLayer,
    selection: &HashSet<ContourId>,
) -> CoreResult<(f64, f64, f64, f64)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut any = false;

    for contour in layer.contours_iter() {
        if !selection.contains(&contour.id()) {
            continue;
        }
        any = true;
        for point in contour.points() {
            let position = point.position();
            min_x = min_x.min(position.x);
            min_y = min_y.min(position.y);
            max_x = max_x.max(position.x);
            max_y = max_y.max(position.y);
        }
    }

    if !any {
        return Err(CoreError::StrokeOperationFailed {
            message: "contour selection is empty".to_string(),
        });
    }

    Ok((min_x, min_y, max_x, max_y))
}

fn anchor_for_opposite_edge(
    edge: InkBoxEdge,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
) -> f64 {
    match edge {
        InkBoxEdge::Left => max_x,
        InkBoxEdge::Right => min_x,
        InkBoxEdge::Bottom => max_y,
        InkBoxEdge::Top => min_y,
    }
}

fn scale_contours_about_anchor(
    layer: &mut GlyphLayer,
    selection: &HashSet<ContourId>,
    edge: InkBoxEdge,
    anchor: f64,
    scale: f64,
) {
    let axis_is_x = matches!(edge, InkBoxEdge::Left | InkBoxEdge::Right);

    for contour in layer.contours_iter_mut() {
        if !selection.contains(&contour.id()) {
            continue;
        }
        for point in contour.points_mut() {
            let position = point.position();
            if axis_is_x {
                let x = anchor + (position.x - anchor) * scale;
                point.set_position(x, position.y);
            } else {
                let y = anchor + (position.y - anchor) * scale;
                point.set_position(position.x, y);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SetLiveStroke;
    use crate::stroke::style::OutlineStrokeStyle;
    use crate::test_support::sample_font;
    use crate::{
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, PointType,
    };

    fn add_stroked_ring(
        font: &mut Font,
        name: &str,
        style: OutlineStrokeStyle,
    ) -> (LayerId, ContourId) {
        let glyph_id = GlyphId::from_raw(name);
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw(format!("{name}_layer"));
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: name.to_string(),
                unicodes: Vec::new(),
            }))
            .unwrap();
        }
        if font.layer(layer_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
            }))
            .unwrap();
        }
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(closed_oval(0.0, 0.0, 200.0, 300.0));
        font.replace_glyph_layers(vec![layer]).unwrap();
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style,
        }))
        .unwrap();
        (layer_id, contour_id)
    }

    fn closed_oval(cx: f64, cy: f64, rx: f64, ry: f64) -> Contour {
        let k = 0.552_284_749_8;
        let mut contour = Contour::new();
        contour.add_point(cx, cy - ry, PointType::OnCurve, false);
        contour.add_point(cx + k * rx, cy - ry, PointType::OffCurve, false);
        contour.add_point(cx + rx, cy - k * ry, PointType::OffCurve, false);
        contour.add_point(cx + rx, cy, PointType::OnCurve, false);
        contour.add_point(cx + rx, cy + k * ry, PointType::OffCurve, false);
        contour.add_point(cx + k * rx, cy + ry, PointType::OffCurve, false);
        contour.add_point(cx, cy + ry, PointType::OnCurve, false);
        contour.add_point(cx - k * rx, cy + ry, PointType::OffCurve, false);
        contour.add_point(cx - rx, cy + k * ry, PointType::OffCurve, false);
        contour.add_point(cx - rx, cy, PointType::OnCurve, false);
        contour.add_point(cx - rx, cy - k * ry, PointType::OffCurve, false);
        contour.add_point(cx - k * rx, cy - ry, PointType::OffCurve, false);
        contour.close();
        contour
    }

    #[test]
    fn contour_set_ink_extent_is_narrower_than_whole_layer_with_siblings() {
        let mut font = sample_font();
        let style = OutlineStrokeStyle::round(40.0);
        let (layer, contour) = add_stroked_ring(&mut font, "ring_bounds", style);
        let subset = font
            .selection_extent(layer, SelectionExtentFilter::Contours(vec![contour]))
            .unwrap();
        let whole = font.layer_extent(layer).unwrap();
        assert_eq!(subset.effective, Measure::Ink);
        assert!(subset.max_x - subset.min_x <= whole.max_x - whole.min_x + 1e-6);
    }

    #[test]
    fn fit_ink_bound_intent_moves_bottom_edge() {
        let mut font = sample_font();
        let style = OutlineStrokeStyle::round(40.0);
        let (layer, contour) = add_stroked_ring(&mut font, "ring_fit", style);
        let target = -10.0;

        font.apply_intents(&FontIntentSet::from(FitInkBound {
            layer_id: layer,
            contour_ids: vec![contour.clone()],
            edge: InkBoundEdge::Bottom,
            target,
        }))
        .unwrap();

        let after = font
            .selection_extent(layer, SelectionExtentFilter::Contours(vec![contour]))
            .unwrap();
        assert!(
            (after.min_y - target).abs() <= DEFAULT_TOLERANCE,
            "ink bottom should land on the typed target"
        );
    }

    #[test]
    fn fit_ink_bound_refuses_target_smaller_than_stroke() {
        let mut font = sample_font();
        let (layer, contour) = stroked_vertical_stem(&mut font, "stem_refuse", 300.0, 80.0);
        let before_y = font
            .layer(layer)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .first()
            .unwrap()
            .position()
            .y;
        let err = font
            .apply_intents(&FontIntentSet::from(FitInkBound {
                layer_id: layer,
                contour_ids: vec![contour],
                edge: InkBoundEdge::Top,
                target: 40.0,
            }))
            .unwrap_err();
        assert!(matches!(err, CoreError::StrokeOperationFailed { .. }));
        let after_y = font
            .layer(layer)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .first()
            .unwrap()
            .position()
            .y;
        assert_eq!(before_y, after_y);
    }

    fn stroked_vertical_stem(
        font: &mut Font,
        name: &str,
        length: f64,
        width: f64,
    ) -> (LayerId, ContourId) {
        let glyph_id = GlyphId::from_raw(name);
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw(format!("{name}_layer"));
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: name.to_string(),
                unicodes: Vec::new(),
            }))
            .unwrap();
        }
        if font.layer(layer_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
            }))
            .unwrap();
        }
        let mut contour = Contour::new();
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, length, PointType::OnCurve, false);
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(contour);
        font.replace_glyph_layers(vec![layer]).unwrap();
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(width),
        }))
        .unwrap();
        (layer_id, contour_id)
    }
}
