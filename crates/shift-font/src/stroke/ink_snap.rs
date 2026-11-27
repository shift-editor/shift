//! Ink snap points: on-curve positions and parametric extrema of solved
//! stroke outlines, for snapping the visible edge of a stroked contour.

use std::collections::HashSet;

use kurbo::{BezPath, ParamCurve, ParamCurveExtrema, PathSeg, Point};

use crate::composite::GlyphComponents;
use crate::contour::SubpathPoints;
use crate::projection::FontProjection;
use crate::{
    ContourId, CoreError, CoreResult, Font, GlyphId, GlyphLayer, LayerId, Require, Transform,
};

use super::exact_offset::DEFAULT_TOLERANCE;
use super::solve_cache::StrokeOutlineCache;

/// Snap points of one skeleton contour's solved ink outline.
#[derive(Clone, Debug, PartialEq)]
pub struct InkSnapContour {
    pub skeleton_contour_id: ContourId,
    /// On-curve points and parametric extrema, deduplicated.
    pub points: Vec<Point>,
}

/// Collects on-curve points and parametric extrema of `subpath`.
///
/// Walks each bezier segment in the outline, records the segment endpoints
/// and evaluates `ParamCurveExtrema::extrema()` to find x/y turning points.
/// Deduplicates within `tolerance`.
fn snap_points_of_subpath(subpath: &SubpathPoints, tolerance: f64) -> Vec<Point> {
    let path = subpath_to_bezpath(subpath);
    let mut points: Vec<Point> = Vec::new();

    for segment in path.segments() {
        let start = segment_start(&segment);
        push_deduplicated(&mut points, start, tolerance);

        for t in segment.extrema().iter().copied() {
            let extremum = segment.eval(t);
            push_deduplicated(&mut points, extremum, tolerance);
        }

        let end = segment_end(&segment);
        push_deduplicated(&mut points, end, tolerance);
    }

    points
}

/// Converts a [`SubpathPoints`] to a [`BezPath`] for kurbo segment iteration.
fn subpath_to_bezpath(subpath: &SubpathPoints) -> BezPath {
    let contour = crate::Contour::from(subpath.clone());
    BezPath::from(&contour)
}

fn segment_start(segment: &PathSeg) -> Point {
    match *segment {
        PathSeg::Line(line) => line.p0,
        PathSeg::Quad(quad) => quad.p0,
        PathSeg::Cubic(cubic) => cubic.p0,
    }
}

fn segment_end(segment: &PathSeg) -> Point {
    match *segment {
        PathSeg::Line(line) => line.p1,
        PathSeg::Quad(quad) => quad.p2,
        PathSeg::Cubic(cubic) => cubic.p3,
    }
}

fn push_deduplicated(points: &mut Vec<Point>, candidate: Point, tolerance: f64) {
    if points.iter().any(|p| p.distance(candidate) < tolerance) {
        return;
    }
    points.push(candidate);
}

/// Applies a transform to a set of points.
fn transform_points(points: &[Point], transform: Transform) -> Vec<Point> {
    points
        .iter()
        .map(|&point| transform.transform_point(point))
        .collect()
}

impl Font {
    /// On-curve points and parametric extrema of the solved stroke outlines
    /// on `layer_id`, grouped by the skeleton contour they belong to.
    ///
    /// Components contribute their base glyph's ink snap points after the
    /// component transform. Returns empty when `ignore_stroke` is on or the
    /// layer has no dynamic strokes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when the layer is missing.
    pub fn ink_snap_points_for_layer(&self, layer_id: LayerId) -> CoreResult<Vec<InkSnapContour>> {
        if !self.include_stroke_in_metrics() {
            return Ok(Vec::new());
        }

        let layer = self
            .layer(layer_id)
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        let source_id = layer
            .source_id()
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        let location = self.require_source(source_id)?.location().clone();
        let mut projection = self.projection(&location);
        let glyph_id = self.require_layer_owner(layer_id)?;

        self.ink_measure_runtime().with_stroke_cache(|cache| {
            ink_snap_points_for_glyph(&mut projection, glyph_id, cache, DEFAULT_TOLERANCE)
        })
    }
}

fn ink_snap_points_for_glyph(
    projection: &mut FontProjection<'_>,
    root_glyph_id: GlyphId,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> CoreResult<Vec<InkSnapContour>> {
    if !projection.prepare_layer_for_extent(root_glyph_id)? {
        return Ok(Vec::new());
    }

    let layers = projection.layers_for_extent();
    let view: std::collections::HashMap<GlyphId, &GlyphLayer> = layers
        .iter()
        .map(|(glyph_id, layer)| (*glyph_id, layer))
        .collect();
    let root_layer = view.get(&root_glyph_id).copied().require(&root_glyph_id)?;

    let mut result = root_layer_snap_points(root_layer, cache, tolerance)?;

    let components = GlyphComponents::from_layers(root_glyph_id, &view)?;
    let occurrence_placements = components
        .occurrences(&view)?
        .into_iter()
        .map(|occurrence| (occurrence.base_glyph_id(), occurrence.transform()))
        .collect::<Vec<_>>();

    for (base_glyph_id, transform) in occurrence_placements {
        let base_points = ink_snap_points_for_glyph(projection, base_glyph_id, cache, tolerance)?;
        for mut contour_snap in base_points {
            contour_snap.points = transform_points(&contour_snap.points, transform);
            result.push(contour_snap);
        }
    }

    Ok(result)
}

fn root_layer_snap_points(
    layer: &GlyphLayer,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> CoreResult<Vec<InkSnapContour>> {
    let stroke_read = layer.stroke_outline_points_for_preview_with(tolerance, cache)?;

    let live_ids: HashSet<_> = layer.live_stroke_contour_ids().into_iter().collect();
    let solved_ids: HashSet<_> = stroke_read
        .solved
        .iter()
        .map(|item| item.skeleton_contour_id.clone())
        .collect();

    let mut result = Vec::new();

    for item in &stroke_read.solved {
        let mut points = Vec::new();
        for subpath in &item.outlines {
            points.extend(snap_points_of_subpath(subpath, tolerance));
        }
        result.push(InkSnapContour {
            skeleton_contour_id: item.skeleton_contour_id.clone(),
            points,
        });
    }

    // A live skeleton that did not solve: skip (do not error — the caller
    // may still want the points of the skeletons that did solve).
    for failure in &stroke_read.failed {
        let _ = &failure.skeleton_contour_id;
    }

    // Plain contours (no live stroke) contribute nothing: their authored
    // on-curve points are already targets through `layer.allPoints`.
    for contour in layer.contours_iter() {
        let contour_id = contour.id();
        if live_ids.contains(&contour_id) && !solved_ids.contains(&contour_id) {
            // Solve failure — skip this contour's ink, the skeleton stays.
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stroke::style::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
    use crate::test_support::sample_font;
    use crate::{
        Component, Contour, CreateGlyph, CreateGlyphLayer, DecomposedTransform, FontIntentSet,
        GlyphId, LayerId, PointType, SetLiveStroke,
    };

    fn stroke_test_layer(font: &mut Font, contour: Contour) -> LayerId {
        let glyph_id = GlyphId::from_raw("snap_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("snap_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "snap_glyph".to_string(),
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
        layer_id
    }

    fn vertical_stem_at(x: f64, length: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(x, 0.0, PointType::OnCurve, false);
        contour.add_point(x, length, PointType::OnCurve, false);
        contour
    }

    fn apply_round_stroke(font: &mut Font, layer_id: LayerId, width: f64) -> ContourId {
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
            preset_id: None,
        }))
        .unwrap();
        contour_id
    }

    fn has_point_near_x(points: &[Point], x: f64, tolerance: f64) -> bool {
        points.iter().any(|p| (p.x - x).abs() < tolerance)
    }

    fn has_point_near_y(points: &[Point], y: f64, tolerance: f64) -> bool {
        points.iter().any(|p| (p.y - y).abs() < tolerance)
    }

    fn has_point_near(points: &[Point], x: f64, y: f64, tolerance: f64) -> bool {
        points
            .iter()
            .any(|p| p.distance(Point::new(x, y)) < tolerance)
    }

    #[test]
    fn vertical_stem_round_stroke_has_ink_extrema_at_offset_edges() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        apply_round_stroke(&mut font, layer_id, 40.0);

        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        assert_eq!(
            snap_contours.len(),
            1,
            "one skeleton contour → one snap entry"
        );

        let points = &snap_contours[0].points;
        assert!(!points.is_empty(), "must have snap points");

        // Ink left edge at x = 80 (100 − 20)
        assert!(
            has_point_near_x(points, 80.0, 2.0),
            "expected ink left edge at ~80, got: {points:?}"
        );
        // Ink right edge at x = 120 (100 + 20)
        assert!(
            has_point_near_x(points, 120.0, 2.0),
            "expected ink right edge at ~120, got: {points:?}"
        );
        // Ink bottom at y ≈ −20 (round cap extends below 0)
        assert!(
            has_point_near_y(points, -20.0, 2.0),
            "expected ink bottom at ~-20, got: {points:?}"
        );
        // Ink top at y ≈ 220 (round cap extends above 200)
        assert!(
            has_point_near_y(points, 220.0, 2.0),
            "expected ink top at ~220, got: {points:?}"
        );
    }

    #[test]
    fn square_cap_includes_cap_corner_extrema() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle {
                width: 40.0,
                cap: StrokeCap::Square,
                join: StrokeJoin::Round,
                miter_limit: OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
                position: 0.0,
            },
            preset_id: None,
        }))
        .unwrap();

        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        let points = &snap_contours[0].points;

        // Square cap extends half-width past each end: corners near (80, −20) and (120, 220)
        assert!(
            has_point_near(points, 80.0, -20.0, 2.0),
            "expected bottom-left cap corner, got: {points:?}"
        );
        assert!(
            has_point_near(points, 120.0, 220.0, 2.0),
            "expected top-right cap corner, got: {points:?}"
        );
    }

    #[test]
    fn plain_layer_returns_empty() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));

        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        assert!(
            snap_contours.is_empty(),
            "a plain layer has no ink snap points"
        );
    }

    #[test]
    fn ignore_stroke_returns_empty() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        apply_round_stroke(&mut font, layer_id, 40.0);

        font.apply_set_ignore_stroke(true);
        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        assert!(
            snap_contours.is_empty(),
            "ignore stroke → no ink snap points"
        );
    }

    #[test]
    fn style_change_changes_snap_points() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let contour_id = apply_round_stroke(&mut font, layer_id, 40.0);

        let narrow = font.ink_snap_points_for_layer(layer_id).unwrap();

        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(60.0),
            preset_id: None,
        }))
        .unwrap();

        let wide = font.ink_snap_points_for_layer(layer_id).unwrap();
        assert_ne!(
            narrow[0].points, wide[0].points,
            "changing the stroke style must change the snap points"
        );
    }

    #[test]
    fn component_ink_snap_points_are_transformed() {
        let mut font = sample_font();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::from_raw("snap_comp_base");
        let base_layer = LayerId::from_raw("snap_comp_base_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(base_id),
            name: "snap_comp_base".to_string(),
            unicodes: vec![],
        }))
        .unwrap();
        font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
            layer_id: base_layer,
            glyph_id: base_id,
            source_id,
        }))
        .unwrap();

        let mut stem = Contour::new();
        stem.add_point(0.0, 100.0, PointType::OnCurve, false);
        stem.add_point(200.0, 100.0, PointType::OnCurve, false);
        let mut layer = font.layer(base_layer).unwrap().clone();
        layer.add_contour(stem);
        font.replace_glyph_layers(vec![layer]).unwrap();

        let contour_id = font
            .layer(base_layer)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id: base_layer,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(40.0),
            preset_id: None,
        }))
        .unwrap();

        // Composite glyph with a translated component
        let composite_id = GlyphId::from_raw("snap_comp");
        let composite_layer = LayerId::from_raw("snap_comp_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(composite_id),
            name: "snap_comp".to_string(),
            unicodes: vec![],
        }))
        .unwrap();
        font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
            layer_id: composite_layer,
            glyph_id: composite_id,
            source_id,
        }))
        .unwrap();

        let transform = DecomposedTransform {
            translate_x: 50.0,
            translate_y: 30.0,
            ..DecomposedTransform::identity()
        };
        let mut comp_layer = font.layer(composite_layer).unwrap().clone();
        comp_layer.add_component(Component::with_transform(
            base_id,
            "snap_comp_base",
            transform,
        ));
        font.replace_glyph_layers(vec![comp_layer]).unwrap();

        let base_points = font.ink_snap_points_for_layer(base_layer).unwrap();
        let comp_points = font.ink_snap_points_for_layer(composite_layer).unwrap();

        assert!(
            !comp_points.is_empty(),
            "composite layer has ink snap points from the component"
        );

        // The component is translated by (50, 30), so snap points should be offset
        let base_first = base_points[0].points[0];
        let comp_first = comp_points[0].points[0];
        assert!(
            (comp_first.x - base_first.x - 50.0).abs() < 2.0,
            "component x offset: expected ~50, got {} vs {}",
            comp_first.x,
            base_first.x
        );
        assert!(
            (comp_first.y - base_first.y - 30.0).abs() < 2.0,
            "component y offset: expected ~30, got {} vs {}",
            comp_first.y,
            base_first.y
        );
    }

    #[test]
    fn closed_ring_has_extrema_at_cardinal_points() {
        let mut font = sample_font();
        // A square closed contour → ring outline has extrema at the 4 cardinal directions
        let mut square = Contour::new();
        square.add_point(0.0, 0.0, PointType::OnCurve, false);
        square.add_point(100.0, 0.0, PointType::OnCurve, false);
        square.add_point(100.0, 100.0, PointType::OnCurve, false);
        square.add_point(0.0, 100.0, PointType::OnCurve, false);
        square.close();

        let layer_id = stroke_test_layer(&mut font, square);
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(20.0),
            preset_id: None,
        }))
        .unwrap();

        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        assert!(
            !snap_contours.is_empty(),
            "closed ring should have snap points"
        );

        let all_points: Vec<_> = snap_contours.iter().flat_map(|c| &c.points).collect();
        // Outer ring extends 10 units past the skeleton: min_x ≈ −10, max_x ≈ 110
        assert!(
            all_points.iter().any(|p| p.x < -5.0),
            "expected outer left extremum past x=0, got: {all_points:?}"
        );
        assert!(
            all_points.iter().any(|p| p.x > 105.0),
            "expected outer right extremum past x=100, got: {all_points:?}"
        );
        assert!(
            all_points.iter().any(|p| p.y < -5.0),
            "expected outer bottom extremum past y=0, got: {all_points:?}"
        );
        assert!(
            all_points.iter().any(|p| p.y > 105.0),
            "expected outer top extremum past y=100, got: {all_points:?}"
        );
    }

    #[test]
    fn snap_points_are_deduplicated() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        apply_round_stroke(&mut font, layer_id, 40.0);

        let snap_contours = font.ink_snap_points_for_layer(layer_id).unwrap();
        let points = &snap_contours[0].points;

        // No two points should be within tolerance of each other
        for (i, a) in points.iter().enumerate() {
            for (j, b) in points.iter().enumerate() {
                if i != j {
                    assert!(
                        a.distance(*b) >= DEFAULT_TOLERANCE * 0.5,
                        "points {i} and {j} are too close: {a:?} vs {b:?}"
                    );
                }
            }
        }
    }
}
