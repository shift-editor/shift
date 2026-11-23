//! Extent of a glyph layer under skeleton or ink measure.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use crate::composite::{GlyphComponents, ResolvedContour, resolved_contours_bbox};
use crate::contour::SubpathPoints;
use crate::projection::FontProjection;
use crate::{
    ContourId, CoreError, CoreResult, Font, GlyphId, GlyphLayer, LayerId, LibValue, Point, PointId,
    Require, Transform,
};

use super::exact_offset::DEFAULT_TOLERANCE;
use super::extent_memo::LayerExtentMemo;
use super::ink_bounds::SelectionExtentFilter;
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
    BetweenMasters,
}

/// Axis-aligned bounds under one measure.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct MeasureBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl From<(f64, f64, f64, f64)> for MeasureBounds {
    fn from((min_x, min_y, max_x, max_y): (f64, f64, f64, f64)) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }
}

/// Bounds and which measure answered the read.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LayerExtent {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub skeleton: MeasureBounds,
    pub ink: Option<MeasureBounds>,
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
/// Ink contours of one glyph with their unioned bounds as
/// `(min_x, min_y, max_x, max_y)`; the bounds are `None` when the contours
/// have no segments.
type InkContours = (Vec<ResolvedContour>, Option<(f64, f64, f64, f64)>);

#[derive(Clone, Debug)]
pub(crate) struct GlyphExtentContours {
    pub contours: Vec<ResolvedContour>,
    /// Bounds of `contours` as `(min_x, min_y, max_x, max_y)`, unioned
    /// during assembly from the solved outlines' cached bounds where the
    /// contours are solved ink; `None` when they have no segments.
    pub bounds: Option<(f64, f64, f64, f64)>,
    pub skeleton: MeasureBounds,
    pub ink: Option<MeasureBounds>,
    pub effective: Measure,
    pub fallback: Option<LayerExtentFallback>,
}

/// Memo of stroke solves for ink extent reads on one font.
///
/// Copies of a font share one runtime: a font is copied for every edit and
/// every preview frame, and both memos are keyed by the content they answer
/// from, so an entry one copy wrote is a pure answer any copy may reuse.
/// Resetting the caches on copy would leave every drag frame solving cold,
/// which is the case they exist for.
#[derive(Clone, Default)]
pub struct InkMeasureRuntime {
    inner: Arc<InkMeasureRuntimeInner>,
}

#[derive(Default)]
struct InkMeasureRuntimeInner {
    stroke_cache: RwLock<StrokeOutlineCache>,
    extent_memo: RwLock<LayerExtentMemo>,
}

impl std::fmt::Debug for InkMeasureRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InkMeasureRuntime")
            .field("stroke_cache_solves", &self.stroke_cache_solves())
            .field("extent_memo_computes", &self.extent_memo_computes())
            .finish()
    }
}

impl InkMeasureRuntime {
    pub(crate) fn with_stroke_cache<R>(
        &self,
        work: impl FnOnce(&mut StrokeOutlineCache) -> R,
    ) -> R {
        let mut cache = self
            .inner
            .stroke_cache
            .write()
            .expect("stroke outline cache lock poisoned");
        work(&mut cache)
    }

    pub(crate) fn with_extent_memo<R>(&self, work: impl FnOnce(&mut LayerExtentMemo) -> R) -> R {
        let mut memo = self
            .inner
            .extent_memo
            .write()
            .expect("layer extent memo lock poisoned");
        work(&mut memo)
    }

    /// Solver misses on this font's caches, shared with its copies.
    pub fn stroke_cache_solves(&self) -> u64 {
        self.inner
            .stroke_cache
            .read()
            .expect("stroke outline cache lock poisoned")
            .solves()
    }

    /// Full extent assemblies on this font's caches, shared with its copies.
    pub fn extent_memo_computes(&self) -> u64 {
        self.inner
            .extent_memo
            .read()
            .expect("layer extent memo lock poisoned")
            .computes()
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
        let measure = self.metrics_measure();
        self.ink_measure_runtime().with_extent_memo(|memo| {
            memo.extent(
                self,
                layer_id,
                SelectionExtentFilter::WholeLayer,
                measure,
                DEFAULT_TOLERANCE,
                || self.compute_layer_extent(layer_id),
            )
        })
    }

    fn compute_layer_extent(&self, layer_id: LayerId) -> CoreResult<LayerExtent> {
        let layer = self.require_layer(layer_id)?;
        let glyph_id = self.require_layer_owner(layer_id)?;
        let source_id = layer
            .source_id()
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        let location = self.require_source(source_id)?.location().clone();
        let mut projection = self.projection(&location);
        let resolved = self.glyph_extent_contours(&mut projection, glyph_id)?;
        let bounds = resolved
            .bounds
            .ok_or_else(|| CoreError::StrokeOperationFailed {
                message: format!("glyph {glyph_id} has no outline to measure"),
            })?;
        let (min_x, min_y, max_x, max_y) = bounds;
        Ok(LayerExtent {
            min_x,
            min_y,
            max_x,
            max_y,
            skeleton: resolved.skeleton,
            ink: resolved.ink,
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
        if !projection.prepare_layer_for_extent(glyph_id)? {
            let skeleton_contours = projection
                .glyph(glyph_id)?
                .map_or_else(Vec::new, |glyph| glyph.contours().to_vec());
            let skeleton = skeleton_bounds_for_extent(&skeleton_contours);
            let bounds = resolved_contours_bbox(&skeleton_contours);
            return Ok(GlyphExtentContours {
                contours: skeleton_contours,
                bounds,
                skeleton,
                ink: None,
                effective: Measure::Skeleton,
                fallback: Some(LayerExtentFallback::BetweenMasters),
            });
        }

        let skeleton_contours = projection
            .glyph(glyph_id)?
            .map_or_else(Vec::new, |glyph| glyph.contours().to_vec());
        let skeleton = skeleton_bounds_for_extent(&skeleton_contours);
        let skeleton_bbox = resolved_contours_bbox(&skeleton_contours);

        let has_stroke = glyph_has_live_stroke_without_prepare(projection, glyph_id);

        let ink_result = if has_stroke {
            Some(self.ink_measure_runtime().with_stroke_cache(|cache| {
                ink_contours_for_glyph(projection, glyph_id, cache, DEFAULT_TOLERANCE)
            }))
        } else {
            None
        };
        let ink_bounds = ink_result
            .as_ref()
            .and_then(|result| result.as_ref().ok())
            .and_then(|(_, bounds)| *bounds)
            .map(MeasureBounds::from);

        if self.metrics_measure() == Measure::Skeleton {
            let fallback = self
                .ignore_stroke_in_metrics()
                .then_some(LayerExtentFallback::IgnoreStroke);
            return Ok(GlyphExtentContours {
                contours: skeleton_contours,
                bounds: skeleton_bbox,
                skeleton,
                ink: ink_bounds,
                effective: Measure::Skeleton,
                fallback,
            });
        }

        if !has_stroke {
            return Ok(GlyphExtentContours {
                contours: skeleton_contours,
                bounds: skeleton_bbox,
                skeleton,
                ink: None,
                effective: Measure::Skeleton,
                fallback: None,
            });
        }

        match ink_result.expect("stroke layers have an ink result") {
            Ok((contours, bounds)) => Ok(GlyphExtentContours {
                contours,
                bounds,
                skeleton,
                ink: ink_bounds,
                effective: Measure::Ink,
                fallback: None,
            }),
            Err(InkSolveFailure { message }) => Ok(GlyphExtentContours {
                contours: skeleton_contours,
                bounds: skeleton_bbox,
                skeleton,
                ink: ink_bounds,
                effective: Measure::Skeleton,
                fallback: Some(LayerExtentFallback::StrokeCouldNotBeSolved { message }),
            }),
        }
    }
}

fn measure_bounds_of(contours: &[ResolvedContour]) -> Option<MeasureBounds> {
    resolved_contours_bbox(contours).map(MeasureBounds::from)
}

/// Skeleton bounds for extent assembly; an empty layer keeps zero bounds so
/// measure readers can report a missing outline.
fn skeleton_bounds_for_extent(contours: &[ResolvedContour]) -> MeasureBounds {
    measure_bounds_of(contours).unwrap_or(MeasureBounds {
        min_x: 0.0,
        min_y: 0.0,
        max_x: 0.0,
        max_y: 0.0,
    })
}

fn glyph_has_live_stroke_without_prepare(
    projection: &mut FontProjection<'_>,
    glyph_id: GlyphId,
) -> bool {
    let _ = glyph_id;
    projection
        .layers_for_extent()
        .values()
        .any(|layer| !layer.live_stroke_contour_ids().is_empty())
}

fn ink_contours_for_glyph(
    projection: &mut FontProjection<'_>,
    root_glyph_id: GlyphId,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> Result<InkContours, InkSolveFailure> {
    if !projection
        .prepare_layer_for_extent(root_glyph_id)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?
    {
        return Ok((Vec::new(), None));
    }

    let layers = projection.layers_for_extent();
    let view = layer_view(layers);
    let root_layer = layer_for_glyph(&view, root_glyph_id).map_err(|error| InkSolveFailure {
        message: error.to_string(),
    })?;

    let (mut contours, mut bounds) = root_layer_contours(root_layer, cache, tolerance)?;
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
        let (base_contours, _) =
            ink_contours_for_glyph(projection, base_glyph_id, cache, tolerance)?;
        let transformed: Vec<ResolvedContour> = base_contours
            .into_iter()
            .map(|contour| transform_resolved_contour(contour, transform))
            .collect();
        // A placed outline's bounds are measured from its transformed
        // contours: the base's own bounds do not survive a rotation.
        bounds = union_bounds(bounds, resolved_contours_bbox(&transformed));
        contours.extend(transformed);
    }
    Ok((contours, bounds))
}

fn root_layer_contours(
    layer: &GlyphLayer,
    cache: &mut StrokeOutlineCache,
    tolerance: f64,
) -> Result<InkContours, InkSolveFailure> {
    let stroke_read = layer
        .stroke_outline_points_for_preview_with(tolerance, cache)
        .map_err(|error| InkSolveFailure {
            message: error.to_string(),
        })?;

    if !stroke_read.failed.is_empty() {
        let message = stroke_read.failed.first().map_or_else(
            || "stroke could not be solved".to_string(),
            |failure| failure.error.to_string(),
        );
        return Err(InkSolveFailure { message });
    }

    let solved_ids: HashSet<_> = stroke_read
        .solved
        .iter()
        .map(|item| &item.skeleton_contour_id)
        .collect();

    let mut by_skeleton: HashMap<&ContourId, Vec<&SubpathPoints>> = HashMap::new();
    let mut bounds_by_skeleton: HashMap<&ContourId, (f64, f64, f64, f64)> = HashMap::new();
    for item in &stroke_read.solved {
        by_skeleton.insert(&item.skeleton_contour_id, item.outlines.iter().collect());
        bounds_by_skeleton.insert(&item.skeleton_contour_id, item.bounds);
    }

    let live_ids: HashSet<_> = layer.live_stroke_contour_ids().into_iter().collect();
    let mut contours = Vec::new();
    let mut bounds: Option<(f64, f64, f64, f64)> = None;
    let mut subpath_index = 0usize;
    for contour in layer.contours_iter() {
        let contour_id = contour.id();
        if let Some(outlines) = by_skeleton.get(&contour_id) {
            for subpath in outlines.iter().copied() {
                contours.push(resolved_contour_from_subpath(subpath, subpath_index));
                subpath_index += 1;
            }
            // The solved bounds were measured at solve time; union them
            // instead of re-measuring every outline point on every read.
            bounds = union_bounds(bounds, bounds_by_skeleton.get(&contour_id).copied());
            continue;
        }
        if live_ids.contains(&contour_id) && !solved_ids.contains(&contour_id) {
            return Err(InkSolveFailure {
                message: format!("stroke could not be solved for contour {contour_id}"),
            });
        }
        let resolved = ResolvedContour::transformed(contour, Transform::identity());
        bounds = union_bounds(
            bounds,
            resolved_contours_bbox(std::slice::from_ref(&resolved)),
        );
        contours.push(resolved);
    }
    Ok((contours, bounds))
}

/// Unions two `(min_x, min_y, max_x, max_y)` bounds, keeping `None` until
/// either side has one.
pub(super) fn union_bounds(
    current: Option<(f64, f64, f64, f64)>,
    next: Option<(f64, f64, f64, f64)>,
) -> Option<(f64, f64, f64, f64)> {
    match (current, next) {
        (Some(a), Some(b)) => Some((a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3))),
        (Some(a), None) => Some(a),
        (None, next) => next,
    }
}

/// Builds the resolved contour for one solved subpath straight from its
/// flat points, with no editable-`Contour` round trip.
///
/// Resolved points are derived render-time geometry whose IDs carry no
/// identity (see `ResolvedContour`), so each point takes an ID derived from
/// its place in this read rather than a fresh random one: minting a random
/// ID costs a system randomness call per point and dominated this read on
/// stroked layers. `subpath_index` is the subpath's index within the read,
/// keeping the derived IDs unique across the read's contours.
fn resolved_contour_from_subpath(subpath: &SubpathPoints, subpath_index: usize) -> ResolvedContour {
    let (coordinates, _) = subpath.coordinates.as_chunks::<2>();
    let points = subpath
        .point_types
        .iter()
        .zip(coordinates)
        .enumerate()
        .map(|(point_index, (point_type, &[x, y]))| {
            Point::new(
                PointId::derived("ink", &format!("{subpath_index}:{point_index}")),
                x,
                y,
                *point_type,
                false,
            )
        })
        .collect();

    ResolvedContour {
        points,
        closed: subpath.closed,
    }
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
    use crate::stroke::style::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
    use crate::test_support::sample_font;
    use crate::{
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, MovePoints,
        PointType, Transform,
    };
    use kurbo::Point;

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
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(40.0),
                preset_id: None,
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
        assert_eq!(extent.skeleton.min_x, extent.min_x);
        assert_eq!(extent.skeleton.max_x, extent.max_x);
        assert!(extent.ink.is_none());
    }

    #[test]
    fn stroked_layer_extent_carries_both_skeleton_and_ink_bounds() {
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
                preset_id: None,
        }))
        .unwrap();

        let extent = font.layer_extent(layer_id).unwrap();
        assert_eq!(extent.effective, Measure::Ink);
        assert!((extent.skeleton.min_x - 100.0).abs() < 1e-6);
        assert!((extent.skeleton.max_x - 100.0).abs() < 1e-6);
        let ink = extent.ink.expect("stroked layer has ink bounds");
        assert!(ink.min_x < extent.skeleton.min_x);
        assert_eq!(extent.min_x, ink.min_x);
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
                preset_id: None,
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
    fn second_read_of_unchanged_ink_layer_adds_no_extent_or_solver_work() {
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
                preset_id: None,
        }))
        .unwrap();

        font.layer_extent(layer_id).unwrap();
        let after_first_solves = font.ink_measure_runtime().stroke_cache_solves();
        let after_first_computes = font.ink_measure_runtime().extent_memo_computes();
        font.layer_extent(layer_id).unwrap();
        assert_eq!(
            font.ink_measure_runtime().stroke_cache_solves(),
            after_first_solves
        );
        assert_eq!(
            font.ink_measure_runtime().extent_memo_computes(),
            after_first_computes
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
                preset_id: None,
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
        assert!(
            points >= 150,
            "expected a dense skeleton, got {points} points"
        );

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
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(40.0),
                preset_id: None,
        }))
        .unwrap();

        let ink = font.layer_extent(layer_id).unwrap();
        font.apply_set_ignore_stroke(true);
        let skeleton = font.layer_extent(layer_id).unwrap();
        assert_ne!(ink.left_sidebearing(), skeleton.left_sidebearing());
    }

    #[test]
    fn square_cap_open_stem_extends_ink_half_width_past_skeleton_end() {
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

        let extent = font.layer_extent(layer_id).unwrap();
        assert!((extent.skeleton.min_y - 0.0).abs() < 1e-6);
        assert!((extent.min_y - (-20.0)).abs() < 2.0);
    }

    #[test]
    fn component_ink_matches_transformed_outline_not_transformed_skeleton_box() {
        use crate::{Component, CreateGlyph, CreateGlyphLayer, DecomposedTransform};
        let mut font = sample_font();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::from_raw("ink_rot_base");
        let base_layer = LayerId::from_raw("ink_rot_base_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(base_id),
            name: "ink_rot_base".to_string(),
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

        let composite_id = GlyphId::from_raw("ink_rot_comp");
        let composite_layer = LayerId::from_raw("ink_rot_comp_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(composite_id),
            name: "ink_rot_comp".to_string(),
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
            translate_y: 20.0,
            rotation: 30.0,
            ..DecomposedTransform::identity()
        };
        let mut comp_layer = font.layer(composite_layer).unwrap().clone();
        comp_layer.add_component(Component::with_transform(
            base_id,
            "ink_rot_base",
            transform,
        ));
        font.replace_glyph_layers(vec![comp_layer]).unwrap();

        let composite_extent = font.layer_extent(composite_layer).unwrap();
        let matrix = transform.to_matrix();
        let base = font.layer_extent(base_layer).unwrap();
        let skeleton_box = transform_aabb(&matrix, base.skeleton);

        assert_eq!(composite_extent.effective, Measure::Ink);
        assert!(composite_extent.max_y - composite_extent.min_y > 30.0);
        assert!(composite_extent.min_y < skeleton_box.min_y - 5.0);
        assert!((composite_extent.min_x - skeleton_box.min_x).abs() > 5.0);
    }

    #[test]
    fn stroke_style_change_resolves_again_identical_read_does_not() {
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
                preset_id: None,
        }))
        .unwrap();
        let narrow = font.layer_extent(layer_id).unwrap();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(50.0),
                preset_id: None,
        }))
        .unwrap();
        let wide = font.layer_extent(layer_id).unwrap();
        assert!(wide.left_sidebearing() < narrow.left_sidebearing() - 2.0);
        let after_style = font.ink_measure_runtime().stroke_cache_solves();
        font.layer_extent(layer_id).unwrap();
        assert_eq!(
            font.ink_measure_runtime().stroke_cache_solves(),
            after_style
        );
    }

    fn transform_aabb(matrix: &Transform, bounds: MeasureBounds) -> MeasureBounds {
        let corners = [
            Point::new(bounds.min_x, bounds.min_y),
            Point::new(bounds.min_x, bounds.max_y),
            Point::new(bounds.max_x, bounds.min_y),
            Point::new(bounds.max_x, bounds.max_y),
        ];
        let transformed: Vec<_> = corners
            .iter()
            .map(|point| matrix.transform_point(*point))
            .collect();
        let min_x = transformed
            .iter()
            .map(|p| p.x)
            .fold(f64::INFINITY, f64::min);
        let max_x = transformed
            .iter()
            .map(|p| p.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = transformed
            .iter()
            .map(|p| p.y)
            .fold(f64::INFINITY, f64::min);
        let max_y = transformed
            .iter()
            .map(|p| p.y)
            .fold(f64::NEG_INFINITY, f64::max);
        MeasureBounds {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    fn last_point(font: &Font, layer_id: LayerId, contour_id: &ContourId) -> PointId {
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
