//! Spike (M9a): scale a stroked selection's skeleton about the opposite edge
//! until a chosen ink box edge lands on a target within solve tolerance.

use std::collections::HashSet;

use crate::{ContourId, Font, GlyphLayer, LayerId};

use super::ink::{LayerExtent, LayerExtentFallback, Measure};

/// Which ink box edge a bounds resize targets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InkBoxEdge {
    Left,
    Right,
    Top,
    Bottom,
}

/// Outcome of a successful ink-edge fit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InkEdgeFitResult {
    /// Skeleton scale about the opposite edge on the fit axis (`1.0` = no change).
    pub scale: f64,
    /// Root-finder iterations (bracket search excluded).
    pub iterations: u32,
}

/// Why an ink-edge fit could not complete.
#[derive(Debug, thiserror::Error)]
pub enum InkEdgeFitError {
    #[error("selection has no contours")]
    EmptySelection,

    #[error("target {target} along {edge:?} is smaller than the stroke can occupy (floor {floor})")]
    TargetSmallerThanStroke {
        edge: InkBoxEdge,
        target: f64,
        floor: f64,
    },

    #[error("ink edge did not move monotonically with scale between {scale_lo} and {scale_hi}")]
    NonMonotonic { scale_lo: f64, scale_hi: f64 },

    #[error("fit did not converge within {max_iterations} iterations (residual {residual})")]
    DidNotConverge { max_iterations: u32, residual: f64 },

    #[error("stroke could not be solved: {message}")]
    StrokeCouldNotBeSolved { message: String },

    #[error(transparent)]
    Core(#[from] crate::CoreError),
}

/// Parameters for [`fit_ink_edge`].
#[derive(Clone, Debug, PartialEq)]
pub struct InkEdgeFitRequest {
    pub layer_id: LayerId,
    pub contour_ids: Vec<ContourId>,
    pub edge: InkBoxEdge,
    pub target: f64,
    pub tolerance: f64,
}

const MAX_ITERATIONS: u32 = 64;
const BRACKET_SCALES: &[f64] = &[0.01, 0.05, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FitAxis {
    X,
    Y,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EdgeMonotonicity {
    IncreasesWithScale,
    DecreasesWithScale,
}

impl InkBoxEdge {
    fn axis(self) -> FitAxis {
        match self {
            Self::Left | Self::Right => FitAxis::X,
            Self::Top | Self::Bottom => FitAxis::Y,
        }
    }

    fn monotonicity(self) -> EdgeMonotonicity {
        match self {
            Self::Right | Self::Top => EdgeMonotonicity::IncreasesWithScale,
            Self::Left | Self::Bottom => EdgeMonotonicity::DecreasesWithScale,
        }
    }

    fn read_extent(self, extent: &LayerExtent) -> f64 {
        match self {
            Self::Left => extent.min_x,
            Self::Right => extent.max_x,
            Self::Top => extent.max_y,
            Self::Bottom => extent.min_y,
        }
    }
}

/// Scales the selection's skeleton about the opposite edge until `edge` is
/// within `tolerance` of `target`, or reports why the fit cannot land.
///
/// The returned `scale` is verified by re-solving ink on the scaled skeleton.
///
/// # Errors
///
/// See [`InkEdgeFitError`].
pub fn fit_ink_edge(
    font: &Font,
    request: InkEdgeFitRequest,
) -> Result<InkEdgeFitResult, InkEdgeFitError> {
    let InkEdgeFitRequest {
        layer_id,
        contour_ids,
        edge,
        target,
        tolerance,
    } = request;

    if contour_ids.is_empty() {
        return Err(InkEdgeFitError::EmptySelection);
    }
    if tolerance <= 0.0 {
        return Err(InkEdgeFitError::DidNotConverge {
            max_iterations: 0,
            residual: tolerance,
        });
    }

    let selection: HashSet<_> = contour_ids.iter().cloned().collect();
    let layer = font.require_layer(layer_id)?;

    let (min_x, min_y, max_x, max_y) = skeleton_bounds(layer, &selection)?;
    let (lo, hi) = match edge.axis() {
        FitAxis::X => (min_x, max_x),
        FitAxis::Y => (min_y, max_y),
    };
    if (hi - lo).abs() <= 1e-6 {
        return Err(InkEdgeFitError::NonMonotonic {
            scale_lo: 1.0,
            scale_hi: 1.0,
        });
    }
    let anchor = anchor_for_edge(edge, min_x, min_y, max_x, max_y);

    let extent_at_one = scaled_ink_extent(font, layer_id, &selection, edge, anchor, 1.0)?;
    let current = edge.read_extent(&extent_at_one);

    if (current - target).abs() <= tolerance {
        return Ok(InkEdgeFitResult {
            scale: 1.0,
            iterations: 0,
        });
    }

    let samples = sample_edges(font, layer_id, &selection, edge, anchor)?;

    ensure_monotonic(edge, &samples)?;

    let (scale_lo, edge_lo, scale_hi, edge_hi) =
        find_bracket(edge, target, &samples).ok_or_else(|| {
            let (floor, target) = stroke_floor_violation(edge, &samples, target);
            if let Some(floor) = floor {
                InkEdgeFitError::TargetSmallerThanStroke {
                    edge,
                    target,
                    floor,
                }
            } else {
                InkEdgeFitError::NonMonotonic {
                    scale_lo: samples[0].0,
                    scale_hi: samples[samples.len() - 1].0,
                }
            }
        })?;

    let context = InkFitContext {
        font,
        layer_id,
        selection: &selection,
        edge,
        anchor,
    };
    let mut bracket = BisectionBracket {
        scale_lo,
        edge_lo,
        scale_hi,
        edge_hi,
    };
    let (scale, iterations) = solve_bisection(&context, target, tolerance, &mut bracket)?;

    let verified = scaled_ink_extent(font, layer_id, &selection, edge, anchor, scale)?;
    let landed = edge.read_extent(&verified);
    if (landed - target).abs() > tolerance {
        return Err(InkEdgeFitError::DidNotConverge {
            max_iterations: iterations,
            residual: (landed - target).abs(),
        });
    }

    Ok(InkEdgeFitResult { scale, iterations })
}

fn skeleton_bounds(
    layer: &GlyphLayer,
    selection: &HashSet<ContourId>,
) -> Result<(f64, f64, f64, f64), InkEdgeFitError> {
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
        return Err(InkEdgeFitError::EmptySelection);
    }

    Ok((min_x, min_y, max_x, max_y))
}

fn anchor_for_edge(edge: InkBoxEdge, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> f64 {
    match edge {
        InkBoxEdge::Left => max_x,
        InkBoxEdge::Right => min_x,
        InkBoxEdge::Bottom => max_y,
        InkBoxEdge::Top => min_y,
    }
}

fn scaled_ink_extent(
    font: &Font,
    layer_id: LayerId,
    selection: &HashSet<ContourId>,
    edge: InkBoxEdge,
    anchor: f64,
    scale: f64,
) -> Result<LayerExtent, InkEdgeFitError> {
    let mut trial = font.clone();
    let mut layer = trial.require_layer(layer_id)?.clone();
    apply_axis_scale(&mut layer, selection, edge.axis(), anchor, scale);
    trial
        .replace_glyph_layers(vec![layer])
        .map_err(InkEdgeFitError::Core)?;
    let extent = trial
        .layer_extent(layer_id)
        .map_err(InkEdgeFitError::Core)?;
    if extent.effective == Measure::Skeleton
        && let Some(LayerExtentFallback::StrokeCouldNotBeSolved { message }) = &extent.fallback
    {
        return Err(InkEdgeFitError::StrokeCouldNotBeSolved {
            message: message.clone(),
        });
    }
    Ok(extent)
}

fn apply_axis_scale(
    layer: &mut GlyphLayer,
    selection: &HashSet<ContourId>,
    axis: FitAxis,
    anchor: f64,
    scale: f64,
) {
    for contour in layer.contours_iter_mut() {
        if !selection.contains(&contour.id()) {
            continue;
        }
        for point in contour.points_mut() {
            let position = point.position();
            match axis {
                FitAxis::X => {
                    let x = anchor + (position.x - anchor) * scale;
                    point.set_position(x, position.y);
                }
                FitAxis::Y => {
                    let y = anchor + (position.y - anchor) * scale;
                    point.set_position(position.x, y);
                }
            }
        }
    }
}

fn sample_edges(
    font: &Font,
    layer_id: LayerId,
    selection: &HashSet<ContourId>,
    edge: InkBoxEdge,
    anchor: f64,
) -> Result<Vec<(f64, f64)>, InkEdgeFitError> {
    let mut samples = Vec::with_capacity(BRACKET_SCALES.len());
    for &scale in BRACKET_SCALES {
        let extent = scaled_ink_extent(font, layer_id, selection, edge, anchor, scale)?;
        samples.push((scale, edge.read_extent(&extent)));
    }
    Ok(samples)
}

fn ensure_monotonic(edge: InkBoxEdge, samples: &[(f64, f64)]) -> Result<(), InkEdgeFitError> {
    let increasing = edge.monotonicity() == EdgeMonotonicity::IncreasesWithScale;
    for window in samples.windows(2) {
        let (_, a) = window[0];
        let (scale_hi, b) = window[1];
        let monotone = if increasing {
            b + 1e-6 >= a
        } else {
            b - 1e-6 <= a
        };
        if !monotone {
            return Err(InkEdgeFitError::NonMonotonic {
                scale_lo: window[0].0,
                scale_hi,
            });
        }
    }
    Ok(())
}

fn find_bracket(
    _edge: InkBoxEdge,
    target: f64,
    samples: &[(f64, f64)],
) -> Option<(f64, f64, f64, f64)> {
    for window in samples.windows(2) {
        let (s0, e0) = window[0];
        let (s1, e1) = window[1];
        let crosses = (e0 <= target && target <= e1) || (e1 <= target && target <= e0);
        if crosses && (e0 - e1).abs() > 1e-9 {
            return Some((s0, e0, s1, e1));
        }
    }
    None
}

fn stroke_floor_violation(
    edge: InkBoxEdge,
    samples: &[(f64, f64)],
    target: f64,
) -> (Option<f64>, f64) {
    let increasing = edge.monotonicity() == EdgeMonotonicity::IncreasesWithScale;
    let limit_edge = if increasing {
        samples
            .iter()
            .map(|(_, e)| *e)
            .fold(f64::NEG_INFINITY, f64::max)
    } else {
        samples
            .iter()
            .map(|(_, e)| *e)
            .fold(f64::INFINITY, f64::min)
    };

    let past_limit = if increasing {
        target > limit_edge
    } else {
        target < limit_edge
    };
    if past_limit {
        (Some(limit_edge), target)
    } else {
        (None, target)
    }
}

struct InkFitContext<'a> {
    font: &'a Font,
    layer_id: LayerId,
    selection: &'a HashSet<ContourId>,
    edge: InkBoxEdge,
    anchor: f64,
}

struct BisectionBracket {
    scale_lo: f64,
    edge_lo: f64,
    scale_hi: f64,
    edge_hi: f64,
}

fn solve_bisection(
    context: &InkFitContext<'_>,
    target: f64,
    tolerance: f64,
    bracket: &mut BisectionBracket,
) -> Result<(f64, u32), InkEdgeFitError> {
    let increasing = context.edge.monotonicity() == EdgeMonotonicity::IncreasesWithScale;
    let mut iterations = 0_u32;

    while iterations < MAX_ITERATIONS {
        iterations += 1;
        let scale_mid = 0.5 * (bracket.scale_lo + bracket.scale_hi);
        let extent = scaled_ink_extent(
            context.font,
            context.layer_id,
            context.selection,
            context.edge,
            context.anchor,
            scale_mid,
        )?;
        let edge_mid = context.edge.read_extent(&extent);
        let residual = (edge_mid - target).abs();
        if residual <= tolerance {
            return Ok((scale_mid, iterations));
        }

        let mid_above = if increasing {
            edge_mid > target
        } else {
            edge_mid < target
        };

        if mid_above {
            bracket.scale_hi = scale_mid;
            bracket.edge_hi = edge_mid;
        } else {
            bracket.scale_lo = scale_mid;
            bracket.edge_lo = edge_mid;
        }
    }

    Err(InkEdgeFitError::DidNotConverge {
        max_iterations: MAX_ITERATIONS,
        residual: (bracket.edge_lo - target)
            .abs()
            .min((bracket.edge_hi - target).abs()),
    })
}

#[cfg(test)]
mod tests {
    use super::super::exact_offset::DEFAULT_TOLERANCE;
    use super::*;
    use crate::SetLiveStroke;
    use crate::contour::Contour;
    use crate::stroke::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
    use crate::test_support::sample_font;
    use crate::{CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, PointType};

    fn wavy_closed_skeleton(cubics: usize, y: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, y, PointType::OnCurve, false);
        for index in 0..cubics {
            let x = f64::from(u32::try_from(index + 1).unwrap_or(1)) * 10.0;
            let bend = if index % 2 == 0 { 30.0 } else { -30.0 };
            contour.add_point(x - 7.0, y + bend, PointType::OffCurve, false);
            contour.add_point(x - 2.0, y - bend, PointType::OffCurve, false);
            contour.add_point(x, y + bend * 0.4, PointType::OnCurve, false);
        }
        contour.close();
        contour
    }

    fn stroke_test_layer(font: &mut Font, contour: Contour) -> (LayerId, ContourId) {
        let glyph_id = GlyphId::from_raw("ink_fit_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("ink_fit_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "ink_fit_glyph".to_string(),
                unicodes: vec![],
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
        layer.add_contour(contour);
        font.replace_glyph_layers(vec![layer]).unwrap();
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        (layer_id, contour_id)
    }

    fn vertical_stem_at(x: f64, length: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x, length, PointType::OnCurve, false);
        contour
    }

    fn horizontal_stem_at(y: f64, x0: f64, length: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(x0, y, PointType::OnCurve, false);
        contour.add_point(x0 + length, y, PointType::OnCurve, false);
        contour
    }

    fn apply_stroke(
        font: &mut Font,
        layer_id: LayerId,
        contour_id: &ContourId,
        style: OutlineStrokeStyle,
    ) {
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style,
            preset_id: None,
        }))
        .unwrap();
    }

    fn fit_request(
        layer_id: LayerId,
        contour_id: ContourId,
        edge: InkBoxEdge,
        target: f64,
    ) -> InkEdgeFitRequest {
        InkEdgeFitRequest {
            layer_id,
            contour_ids: vec![contour_id],
            edge,
            target,
            tolerance: DEFAULT_TOLERANCE,
        }
    }

    fn assert_edge_lands(
        font: &Font,
        layer_id: LayerId,
        contour_id: &ContourId,
        edge: InkBoxEdge,
        target: f64,
        scale: f64,
    ) {
        let selection = HashSet::from([contour_id.clone()]);
        let layer = font.layer(layer_id).unwrap();
        let (min_x, min_y, max_x, max_y) = skeleton_bounds(layer, &selection).unwrap();
        let anchor = anchor_for_edge(edge, min_x, min_y, max_x, max_y);
        let scaled = scaled_ink_extent(font, layer_id, &selection, edge, anchor, scale).unwrap();
        let landed = edge.read_extent(&scaled);
        assert!(
            (landed - target).abs() <= DEFAULT_TOLERANCE,
            "expected {edge:?} {target}, got {landed} at scale {scale}"
        );
    }

    #[test]
    fn round_cap_open_stem_left_edge_grows_and_shrinks() {
        let mut font = sample_font();
        let (layer_id, contour_id) =
            stroke_test_layer(&mut font, horizontal_stem_at(100.0, 100.0, 200.0));
        apply_stroke(
            &mut font,
            layer_id,
            &contour_id,
            OutlineStrokeStyle::round(40.0),
        );

        let shrink_target = 60.0;
        let grown = fit_ink_edge(
            &font,
            fit_request(
                layer_id,
                contour_id.clone(),
                InkBoxEdge::Left,
                shrink_target,
            ),
        )
        .unwrap();
        assert!(grown.scale > 1.0);
        assert_edge_lands(
            &font,
            layer_id,
            &contour_id,
            InkBoxEdge::Left,
            shrink_target,
            grown.scale,
        );

        let expand_target = 95.0;
        let shrunk = fit_ink_edge(
            &font,
            fit_request(
                layer_id,
                contour_id.clone(),
                InkBoxEdge::Left,
                expand_target,
            ),
        )
        .unwrap();
        assert!(shrunk.scale < 1.0);
        assert_edge_lands(
            &font,
            layer_id,
            &contour_id,
            InkBoxEdge::Left,
            expand_target,
            shrunk.scale,
        );
    }

    #[test]
    fn square_cap_open_stem_bottom_edge() {
        let mut font = sample_font();
        let (layer_id, contour_id) = stroke_test_layer(&mut font, vertical_stem_at(0.0, 300.0));
        let style = OutlineStrokeStyle {
            width: 30.0,
            cap: StrokeCap::Square,
            join: StrokeJoin::Round,
            miter_limit: OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
            position: 0.0,
        };
        apply_stroke(&mut font, layer_id, &contour_id, style);

        let target = -12.0;
        let fit = fit_ink_edge(
            &font,
            fit_request(layer_id, contour_id.clone(), InkBoxEdge::Bottom, target),
        )
        .unwrap();
        assert_edge_lands(
            &font,
            layer_id,
            &contour_id,
            InkBoxEdge::Bottom,
            target,
            fit.scale,
        );
    }

    #[test]
    fn miter_joint_closed_ring_height() {
        let mut font = sample_font();
        let mut square = Contour::new();
        square.add_point(0.0, 0.0, PointType::OnCurve, false);
        square.add_point(200.0, 0.0, PointType::OnCurve, false);
        square.add_point(200.0, 200.0, PointType::OnCurve, false);
        square.add_point(0.0, 200.0, PointType::OnCurve, false);
        square.close();
        let (layer_id, contour_id) = stroke_test_layer(&mut font, square);
        let style = OutlineStrokeStyle {
            width: 20.0,
            cap: StrokeCap::Round,
            join: StrokeJoin::Miter,
            miter_limit: 8.0,
            position: 0.0,
        };
        apply_stroke(&mut font, layer_id, &contour_id, style);

        let target = 260.0;
        let fit = fit_ink_edge(
            &font,
            fit_request(layer_id, contour_id.clone(), InkBoxEdge::Top, target),
        )
        .unwrap();
        assert_edge_lands(
            &font,
            layer_id,
            &contour_id,
            InkBoxEdge::Top,
            target,
            fit.scale,
        );
    }

    #[test]
    fn already_at_target_returns_unit_scale() {
        let mut font = sample_font();
        let (layer_id, contour_id) =
            stroke_test_layer(&mut font, horizontal_stem_at(100.0, 100.0, 200.0));
        apply_stroke(
            &mut font,
            layer_id,
            &contour_id,
            OutlineStrokeStyle::round(40.0),
        );
        let ink = font.layer_extent(layer_id).unwrap();
        let target = ink.min_x;
        let fit = fit_ink_edge(
            &font,
            fit_request(layer_id, contour_id, InkBoxEdge::Left, target),
        )
        .unwrap();
        assert_eq!(fit.scale, 1.0);
        assert_eq!(fit.iterations, 0);
    }

    #[test]
    fn target_smaller_than_stroke_is_refused() {
        let mut font = sample_font();
        let (layer_id, contour_id) = stroke_test_layer(&mut font, vertical_stem_at(100.0, 400.0));
        apply_stroke(
            &mut font,
            layer_id,
            &contour_id,
            OutlineStrokeStyle::round(80.0),
        );
        let err = fit_ink_edge(
            &font,
            fit_request(layer_id, contour_id, InkBoxEdge::Top, 5.0),
        )
        .unwrap_err();
        assert!(
            matches!(
                err,
                InkEdgeFitError::TargetSmallerThanStroke { .. }
                    | InkEdgeFitError::NonMonotonic { .. }
            ),
            "unexpected: {err:?}"
        );
    }

    #[test]
    fn acute_miter_spike_records_monotonicity_or_convergence() {
        let mut font = sample_font();
        let mut zig = Contour::new();
        zig.add_point(0.0, 0.0, PointType::OnCurve, false);
        zig.add_point(120.0, 0.0, PointType::OnCurve, false);
        zig.add_point(60.0, 2.0, PointType::OnCurve, false);
        zig.add_point(120.0, 0.0, PointType::OnCurve, false);
        zig.add_point(240.0, 0.0, PointType::OnCurve, false);
        let (layer_id, contour_id) = stroke_test_layer(&mut font, zig);
        let style = OutlineStrokeStyle {
            width: 48.0,
            cap: StrokeCap::Square,
            join: StrokeJoin::Miter,
            miter_limit: 20.0,
            position: 0.0,
        };
        apply_stroke(&mut font, layer_id, &contour_id, style);
        let result = fit_ink_edge(
            &font,
            fit_request(layer_id, contour_id.clone(), InkBoxEdge::Top, 28.0),
        );
        match result {
            Ok(fit) => assert_edge_lands(
                &font,
                layer_id,
                &contour_id,
                InkBoxEdge::Top,
                28.0,
                fit.scale,
            ),
            Err(InkEdgeFitError::NonMonotonic { .. } | InkEdgeFitError::DidNotConverge { .. }) => {}
            Err(other) => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    #[ignore = "manual release ink-read benchmark; run with --release -- --ignored"]
    fn ink_read_cost_on_six_hundred_point_wavy_ring() {
        let mut font = sample_font();
        let (layer_id, contour_id) = stroke_test_layer(&mut font, wavy_closed_skeleton(200, 0.0));
        apply_stroke(
            &mut font,
            layer_id,
            &contour_id,
            OutlineStrokeStyle::round(24.0),
        );
        let points = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .len();
        assert!(points >= 600, "expected ~600 skeleton points, got {points}");

        let cold_font = font.clone();
        let cold_start = std::time::Instant::now();
        cold_font.layer_extent(layer_id).unwrap();
        let cold = cold_start.elapsed();

        font.layer_extent(layer_id).unwrap();
        let warm_start = std::time::Instant::now();
        font.layer_extent(layer_id).unwrap();
        let warm = warm_start.elapsed();

        eprintln!(
            "M9a ink read (~{points} pts, tolerance {DEFAULT_TOLERANCE}): cold {cold:?}, warm {warm:?}"
        );
    }
}
