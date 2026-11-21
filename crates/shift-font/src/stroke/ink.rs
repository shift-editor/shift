//! Extent of a glyph layer under skeleton or ink measure.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use crate::composite::{GlyphComponents, ResolvedContour, resolved_contours_bbox};
use crate::contour::SubpathPoints;
use crate::projection::FontProjection;
use crate::{
    Contour, ContourId, CoreError, CoreResult, Font, GlyphId, GlyphLayer, LayerId, LibValue,
    Require, Transform,
};

use super::exact_offset::DEFAULT_TOLERANCE;
use super::solve_cache::StrokeOutlineCache;

/// Which geometry a layer extent read uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum Measure {
    Skeleton,
    Ink,
}

/// Why an ink read measured the skeleton instead.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum LayerExtentFallback {
    StrokeCouldNotBeSolved { message: String },
    IgnoreStroke,
}

/// Bounds and which measure answered the read.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LayerExtent {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub effective: Measure,
    pub fallback: Option<LayerExtentFallback>,
}

impl LayerExtent {
    pub fn left_sidebearing(&self) -> f64 {
        self.min_x
    }

    /// Right sidebearing from `advance` and the effective outline edge.
    pub fn right_sidebearing(&self, advance: f64) -> f64 {
        advance - self.max_x
    }
}

/// Contours resolved for one glyph under the font's current metrics measure.
#[derive(Clone, Debug)]
pub(crate) struct GlyphExtentContours {
    pub contours: Vec<ResolvedContour>,
    pub effective: Measure,
    pub fallback: Option<LayerExtentFallback>,
}

/// Memo of stroke solves for ink extent reads on one font.
#[derive(Default)]
pub struct InkMeasureRuntime {
    stroke_cache: RefCell<StrokeOutlineCache>,
}

impl std::fmt::Debug for InkMeasureRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InkMeasureRuntime")
            .field("stroke_cache_solves", &self.stroke_cache_solves())
            .finish()
    }
}

impl Clone for InkMeasureRuntime {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl InkMeasureRuntime {
    pub(crate) fn with_stroke_cache<R>(
        &self,
        work: impl FnOnce(&mut StrokeOutlineCache) -> R,
    ) -> R {
        work(&mut self.stroke_cache.borrow_mut())
    }

    /// Solver misses since this font copy was created.
    pub fn stroke_cache_solves(&self) -> u64 {
        self.stroke_cache.borrow().solves()
    }
}

/// Glyph lib key: when true, metrics read the skeleton instead of the ink.
pub const IGNORE_STROKE_LIB_KEY: &str = "com.shift.ignoreStroke";

struct InkSolveFailure {
    message: String,
}

impl Font {
    /// Whether metrics include live stroke ink; absent lib key means include.
    pub fn include_stroke_in_metrics(&self) -> bool {
        !self.ignore_stroke_in_metrics()
    }

    /// Stored `com.shift.ignoreStroke` preference.
    pub fn ignore_stroke_in_metrics(&self) -> bool {
        matches!(
            self.lib().get(IGNORE_STROKE_LIB_KEY),
            Some(LibValue::Boolean(true))
        )
    }

    /// The active measure for metrics: ink by default, skeleton when ignored.
    pub fn metrics_measure(&self) -> Measure {
        if self.include_stroke_in_metrics() {
            Measure::Ink
        } else {
            Measure::Skeleton
        }
    }

    pub(crate) fn apply_set_ignore_stroke(&mut self, ignore: bool) {
        if ignore {
            self.lib_mut()
                .set(IGNORE_STROKE_LIB_KEY.to_string(), LibValue::Boolean(true));
        } else {
            self.lib_mut().remove(IGNORE_STROKE_LIB_KEY);
        }
    }

    /// Bounds of `layer_id` under the font's current metrics measure.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when the layer is missing and the
    /// font's error when the layer cannot be resolved at its source.
    pub fn layer_extent(&self, layer_id: LayerId) -> CoreResult<LayerExtent> {
        let layer = self.require_layer(layer_id)?;
        let glyph_id = self.require_layer_owner(layer_id)?;
        let source_id = layer
            .source_id()
            .ok_or_else(|| CoreError::LayerNotFound(layer_id))?;
        let location = self.require_source(source_id)?.location().clone();
        let mut projection = self.projection(&location);
        let resolved = self.glyph_extent_contours(&mut projection, glyph_id)?;
        let bounds = resolved_contours_bbox(&resolved.contours).ok_or_else(|| {
            CoreError::StrokeOperationFailed {
                message: format!("glyph {glyph_id} has no outline to measure"),
            }
        })?;
        let (min_x, min_y, max_x, max_y) = bounds;
        Ok(LayerExtent {
            min_x,
            min_y,
            max_x,
            max_y,
            effective: resolved.effective,
            fallback: resolved.fallback,
        })
    }

    /// Flattened contours for `glyph_id` under the font's current metrics measure.
    ///
    /// # Errors
    ///
    /// Returns projection errors when a component cannot be resolved.
    pub(crate) fn glyph_extent_contours(
        &self,
        projection: &mut FontProjection<'_>,
        glyph_id: GlyphId,
    ) -> CoreResult<GlyphExtentContours> {
        let skeleton = projection
            .glyph(glyph_id)?
            .map_or_else(Vec::new, |glyph| glyph.contours().to_vec());

        if self.metrics_measure() == Measure::Skeleton {
            let fallback = self
                .ignore_stroke_in_metrics()
                .then_some(LayerExtentFallback::IgnoreStroke);
            return Ok(GlyphExtentContours {
                contours: skeleton,
                effective: Measure::Skeleton,
                fallback,
            });
        }

        if !glyph_has_live_stroke(projection, glyph_id)? {
            return Ok(GlyphExtentContours {
                contours: skeleton,
                effective: Measure::Skeleton,
                fallback: None,
            });
        }

        let ink = self.ink_measure_runtime().with_stroke_cache(|cache| {
            ink_contours_for_glyph(projection, glyph_id, cache, DEFAULT_TOLERANCE)
        });

        match ink {
            Ok(contours) => Ok(GlyphExtentContours {
                contours,
                effective: Measure::Ink,
                fallback: None,
            }),
            Err(InkSolveFailure { message }) => Ok(GlyphExtentContours {
                contours: skeleton,
                effective: Measure::Skeleton,
                fallback: Some(LayerExtentFallback::StrokeCouldNotBeSolved { message }),
            }),
        }
    }
}

fn glyph_has_live_stroke(
    projection: &mut FontProjection<'_>,
    glyph_id: GlyphId,
) -> CoreResult<bool> {
    if !projection.prepare_layer_for_extent(glyph_id)? {
        return Ok(false);
    }
    if projection
        .layers_for_extent()
        .values()
        .any(|layer| !layer.live_stroke_contour_ids().is_empty())
    {
        return Ok(true);
    }
    Ok(false)
}

fn ink_contours_for_glyph(
    projection: &mut FontProjection<'_>,
    root_glyph_id: GlyphId,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> Result<Vec<ResolvedContour>, InkSolveFailure> {
    if !projection
        .prepare_layer_for_extent(root_glyph_id)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?
    {
        return Ok(Vec::new());
    }

    let layers = projection.layers_for_extent();
    let view = layer_view(layers);
    let root_layer = layer_for_glyph(&view, root_glyph_id).map_err(|error| InkSolveFailure {
        message: error.to_string(),
    })?;

    let mut contours = root_layer_contours(root_layer, cache, tolerance)?;
    let components =
        GlyphComponents::from_layers(root_glyph_id, &view).map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?;
    let occurrence_placements = components
        .occurrences(&view)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?
        .into_iter()
        .map(|occurrence| (occurrence.base_glyph_id(), occurrence.transform()))
        .collect::<Vec<_>>();
    for (base_glyph_id, transform) in occurrence_placements {
        let base_contours = ink_contours_for_glyph(projection, base_glyph_id, cache, tolerance)?;
        contours.extend(
            base_contours
                .into_iter()
                .map(|contour| transform_resolved_contour(contour, transform)),
        );
    }
    Ok(contours)
}

fn root_layer_contours(
    layer: &GlyphLayer,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> Result<Vec<ResolvedContour>, InkSolveFailure> {
    let stroke_read = layer
        .stroke_outline_points_for_preview_with(tolerance, cache)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?;

    if !stroke_read.failed.is_empty() {
        let message = stroke_read
            .failed
            .first()
            .map(|failure| failure.error.to_string())
            .unwrap_or_else(|| "stroke could not be solved".to_string());
        return Err(InkSolveFailure { message });
    }

    let solved_ids: HashSet<_> = stroke_read
        .solved
        .iter()
        .map(|item| &item.skeleton_contour_id)
        .collect();

    let mut by_skeleton: HashMap<&ContourId, Vec<&SubpathPoints>> = HashMap::new();
    for item in &stroke_read.solved {
        by_skeleton.insert(&item.skeleton_contour_id, item.outlines.iter().collect());
    }

    let live_ids: HashSet<_> = layer.live_stroke_contour_ids().into_iter().collect();
    let mut contours = Vec::new();
    for contour in layer.contours_iter() {
        let contour_id = contour.id();
        if let Some(outlines) = by_skeleton.get(&contour_id) {
            for subpath in outlines.iter().copied() {
                contours.push(resolved_contour_from_subpath(subpath));
            }
            continue;
        }
        if live_ids.contains(&contour_id) && !solved_ids.contains(&contour_id) {
            return Err(InkSolveFailure {
                message: format!("stroke could not be solved for contour {contour_id}"),
            });
        }
        contours.push(ResolvedContour::transformed(contour, Transform::identity()));
    }
    Ok(contours)
}

fn resolved_contour_from_subpath(subpath: &SubpathPoints) -> ResolvedContour {
    let contour = Contour::from(subpath.clone());
    ResolvedContour::transformed(&contour, Transform::identity())
}

fn transform_resolved_contour(contour: ResolvedContour, transform: Transform) -> ResolvedContour {
    let mut transformed = contour;
    for point in &mut transformed.points {
        let position = transform.transform_point(point.position());
        *point = point.copied_to(position);
    }
    transformed
}

fn layer_view(layers: &HashMap<GlyphId, GlyphLayer>) -> HashMap<GlyphId, &GlyphLayer> {
    layers
        .iter()
        .map(|(glyph_id, layer)| (*glyph_id, layer))
        .collect()
}

fn layer_for_glyph<'a>(
    layers: &HashMap<GlyphId, &'a GlyphLayer>,
    glyph_id: GlyphId,
) -> CoreResult<&'a GlyphLayer> {
    layers.get(&glyph_id).copied().require(&glyph_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SetLiveStroke;
    use crate::stroke::OutlineStrokeStyle;
    use crate::test_support::sample_font;
    use crate::{
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, MovePoints,
        PointType,
    };

    fn stroke_test_layer(font: &mut Font, contour: Contour) -> LayerId {
        let glyph_id = GlyphId::from_raw("ink_extent_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("ink_extent_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "ink_extent_glyph".to_string(),
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

    #[test]
    fn ink_lsb_of_a_40_unit_round_stroke_on_a_stem_at_100_is_80() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let layer = font.layer(layer_id).unwrap();
        let contour_id = layer.contours_iter().next().unwrap().id();

        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(40.0),
        }))
        .unwrap();

        let extent = font.layer_extent(layer_id).unwrap();
        assert_eq!(extent.effective, Measure::Ink);
        assert!(extent.fallback.is_none());
        assert!((extent.left_sidebearing() - 80.0).abs() < 2.0);
    }

    #[test]
    fn skeleton_extent_equals_resolved_contours_bbox() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));

        let extent = font.layer_extent(layer_id).unwrap();
        assert_eq!(extent.effective, Measure::Skeleton);

        let source_id = font.layer(layer_id).unwrap().source_id().unwrap();
        let location = font.require_source(source_id).unwrap().location().clone();
        let mut projection = font.projection(&location);
        let glyph_id = font.require_layer_owner(layer_id).unwrap();
        let resolved = projection.glyph(glyph_id).unwrap().unwrap();
        let contours = resolved.contours();
        let (min_x, min_y, max_x, max_y) = resolved_contours_bbox(contours).unwrap();

        assert!((extent.min_x - min_x).abs() < 1e-6);
        assert!((extent.min_y - min_y).abs() < 1e-6);
        assert!((extent.max_x - max_x).abs() < 1e-6);
        assert!((extent.max_y - max_y).abs() < 1e-6);
    }

    #[test]
    fn a_plain_layer_reads_the_same_under_both_measures() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let extent = font.layer_extent(layer_id).unwrap();
        font.apply_set_ignore_stroke(false);
        let with_switch = font.layer_extent(layer_id).unwrap();
        assert_eq!(extent, with_switch);
    }

    #[test]
    fn a_partly_failed_layer_falls_back_to_skeleton_with_reason() {
        let mut font = sample_font();
        let mut triangle = Contour::new();
        triangle.add_point(0.0, 0.0, PointType::OnCurve, false);
        triangle.add_point(120.0, 0.0, PointType::OnCurve, false);
        triangle.add_point(60.0, 90.0, PointType::OnCurve, false);
        triangle.close();

        let mut stem = Contour::new();
        stem.add_point(0.0, 400.0, PointType::OnCurve, false);
        stem.add_point(100.0, 400.0, PointType::OnCurve, false);

        let layer_id = stroke_test_layer(&mut font, triangle);
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(stem);
        font.replace_glyph_layers(vec![layer]).unwrap();

        let ids: Vec<_> = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .map(Contour::id)
            .collect();
        let contour_ids = ids.clone();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids,
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        let bad = ids[1].clone();
        let end = last_point(&font, layer_id, &bad);
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end],
            coords: vec![0.0, 400.0],
        }))
        .unwrap();

        let extent = font.layer_extent(layer_id).unwrap();
        assert_eq!(extent.effective, Measure::Skeleton);
        match extent.fallback {
            Some(LayerExtentFallback::StrokeCouldNotBeSolved { .. }) => {}
            other => panic!("expected stroke fallback, got {other:?}"),
        }
    }

    #[test]
    fn second_read_of_unchanged_ink_layer_adds_no_solver_work() {
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
            style: OutlineStrokeStyle::round(40.0),
        }))
        .unwrap();

        font.layer_extent(layer_id).unwrap();
        let after_first = font.ink_measure_runtime().stroke_cache_solves();
        font.layer_extent(layer_id).unwrap();
        assert_eq!(
            font.ink_measure_runtime().stroke_cache_solves(),
            after_first
        );
    }

    #[test]
    fn set_ignore_stroke_is_one_undo_step_and_touches_no_layer() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let layer_before = font.layer(layer_id).unwrap().clone();

        let outcome = font
            .apply_intents(&FontIntentSet::from(crate::SetIgnoreStroke {
                ignore: true,
            }))
            .unwrap();
        assert!(outcome.layers.is_empty());
        assert_eq!(outcome.changes.changes.len(), 1);
        assert!(font.ignore_stroke_in_metrics());

        font.apply_change_set(&outcome.changes.inverted()).unwrap();
        assert!(!font.ignore_stroke_in_metrics());
        assert_eq!(font.layer(layer_id).unwrap(), &layer_before);
    }

    fn wavy_skeleton(cubics: usize, y: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, y, PointType::OnCurve, false);
        for index in 0..cubics {
            let x = f64::from(u32::try_from(index + 1).unwrap()) * 12.0;
            let bend = if index % 2 == 0 { 40.0 } else { -40.0 };
            contour.add_point(x - 9.0, y + bend, PointType::OffCurve, false);
            contour.add_point(x - 3.0, y - bend, PointType::OffCurve, false);
            contour.add_point(x, y + bend * 0.5, PointType::OnCurve, false);
        }
        contour
    }

    #[test]
    fn one_ink_read_on_a_dense_stroked_glyph_is_timed() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, wavy_skeleton(50, 0.0));
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
            style: OutlineStrokeStyle::round(24.0),
        }))
        .unwrap();

        let points = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .len();
        assert!(points >= 150, "expected a dense skeleton, got {points} points");

        let started = std::time::Instant::now();
        font.layer_extent(layer_id).unwrap();
        let elapsed = started.elapsed();
        eprintln!("ink read on ~{points} skeleton points: {elapsed:?}");
        assert!(elapsed.as_millis() < 5_000);
    }

    #[test]
    fn measure_mutation_check_ink_extent_changes_lsb_not_skeleton() {
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
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(40.0),
        }))
        .unwrap();

        let ink = font.layer_extent(layer_id).unwrap();
        font.apply_set_ignore_stroke(true);
        let skeleton = font.layer_extent(layer_id).unwrap();
        assert_ne!(ink.left_sidebearing(), skeleton.left_sidebearing());
    }

    fn last_point(font: &Font, layer_id: LayerId, contour_id: &ContourId) -> crate::PointId {
        font.layer(layer_id)
            .unwrap()
            .contour(contour_id)
            .unwrap()
            .points()
            .last()
            .unwrap()
            .id()
    }
}
