//! Bounded memo of [`LayerExtent`] reads, keyed by everything extent resolution reads.
//!
//! A drag re-reads the same layer many times; the stroke solve cache already
//! avoids re-solving. This cache skips projection, component flattening, and
//! outline assembly when the layer's effective input is unchanged.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use crate::GlyphLayer;
use crate::component::{Component, DecomposedTransform};
use crate::contour::Contour;
use crate::entity::{GlyphId, LayerId};
use crate::ir::axis::DesignLocation;
use crate::stroke::ink::{LayerExtent, Measure};
use crate::stroke::layer_lib::LayerStrokeLib;
use crate::stroke::style::{OutlineStrokeStyle, StrokeCap, StrokeJoin};
use crate::{Font, PointType};

use super::ink_bounds::SelectionExtentFilter;

const DEFAULT_EXTENT_ENTRIES: usize = 64;
const TAG_LAYER: u64 = 1;
const TAG_LOCATION: u64 = 2;
const TAG_GLYPH: u64 = 3;
const TAG_SENTINEL_A: u64 = 0xFFFF_FFFF_FFFF_FF00;
const TAG_SENTINEL_B: u64 = 0xFFFF_FFFF_FFFF_FF01;
const TAG_SENTINEL_C: u64 = 0xFFFF_FFFF_FFFF_FF02;
const TAG_SENTINEL_D: u64 = 0xFFFF_FFFF_FFFF_FF03;
const TAG_CONTOUR_END: u64 = 4;

type ExtentKey = Arc<[u64]>;

#[derive(Clone, Debug, PartialEq)]
struct CachedExtent {
    used: u64,
    extent: LayerExtent,
}

/// LRU memo of whole-layer extent results on one font copy.
pub struct LayerExtentMemo {
    max_entries: usize,
    clock: u64,
    computes: u64,
    entries: HashMap<ExtentKey, CachedExtent>,
    by_use: BTreeMap<u64, ExtentKey>,
}

impl Default for LayerExtentMemo {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_EXTENT_ENTRIES)
    }
}

impl LayerExtentMemo {
    pub fn with_capacity(max_entries: usize) -> Self {
        Self {
            max_entries,
            clock: 0,
            computes: 0,
            entries: HashMap::new(),
            by_use: BTreeMap::new(),
        }
    }

    /// Extent assembly runs on cache misses (tests and profiles).
    pub fn computes(&self) -> u64 {
        self.computes
    }

    /// Returns the layer extent, reusing a cached read when the key matches.
    ///
    /// # Errors
    ///
    /// Returns the error from key construction or from `compute`.
    pub fn extent(
        &mut self,
        font: &Font,
        layer_id: LayerId,
        filter: SelectionExtentFilter,
        measure: Measure,
        tolerance: f64,
        compute: impl FnOnce() -> crate::CoreResult<LayerExtent>,
    ) -> crate::CoreResult<LayerExtent> {
        if self.max_entries == 0 {
            self.computes += 1;
            return compute();
        }

        let key = extent_key(font, layer_id, filter, measure, tolerance)?;
        if let Some(extent) = self.reuse(&key) {
            return Ok(extent);
        }

        self.computes += 1;
        let extent = compute()?;
        self.store(key, extent.clone());
        Ok(extent)
    }

    fn reuse(&mut self, key: &[u64]) -> Option<LayerExtent> {
        let (stored_key, entry) = self.entries.get_key_value(key)?;
        let stored_key = Arc::clone(stored_key);
        let previous_use = entry.used;
        self.by_use.remove(&previous_use);
        self.clock += 1;
        self.by_use.insert(self.clock, stored_key);
        let entry = self.entries.get_mut(key)?;
        entry.used = self.clock;
        Some(entry.extent.clone())
    }

    fn store(&mut self, key: ExtentKey, extent: LayerExtent) {
        if self.entries.len() >= self.max_entries
            && let Some((_, oldest)) = self.by_use.pop_first()
        {
            self.entries.remove(&oldest);
        }

        if let Some(replaced) = self.entries.remove(&key) {
            self.by_use.remove(&replaced.used);
        }

        self.clock += 1;
        self.by_use.insert(self.clock, Arc::clone(&key));
        self.entries.insert(
            key,
            CachedExtent {
                used: self.clock,
                extent,
            },
        );
    }
}

/// Builds the content key for a layer extent read (for timing tests).
///
/// # Errors
///
/// Returns [`crate::CoreError`] when the layer, owner, or source is missing.
pub fn extent_key(
    font: &Font,
    layer_id: LayerId,
    filter: SelectionExtentFilter,
    measure: Measure,
    tolerance: f64,
) -> crate::CoreResult<ExtentKey> {
    let layer = font.require_layer(layer_id)?;
    let glyph_id = font.require_layer_owner(layer_id)?;
    let source_id = layer
        .source_id()
        .ok_or(crate::CoreError::LayerNotFound(layer_id))?;
    let location = font.require_source(source_id)?.location().clone();

    let mut key = Vec::with_capacity(256);
    push_layer_id(&mut key, layer_id);
    hash_design_location(&mut key, &location, font.axes());
    key.push(match measure {
        Measure::Skeleton => 0,
        Measure::Ink => 1,
    });
    key.push(u64::from(font.ignore_stroke_in_metrics()));
    key.push(tolerance.to_bits());
    hash_selection_filter(&mut key, filter);
    hash_layer_tree(font, glyph_id, layer_id, &mut key)?;

    Ok(Arc::from(key))
}

fn push_layer_id(key: &mut Vec<u64>, layer_id: LayerId) {
    key.push(TAG_LAYER);
    for byte in layer_id.as_str().as_bytes() {
        key.push(u64::from(*byte));
    }
    key.push(TAG_SENTINEL_A);
}

fn hash_design_location(key: &mut Vec<u64>, location: &DesignLocation, axes: &[crate::Axis]) {
    key.push(TAG_LOCATION);
    for axis in axes {
        let value = match location.get(&axis.id()) {
            Some(value) => value,
            None => axis.default(),
        };
        key.push(value.to_bits());
    }
    key.push(u64::try_from(axes.len()).unwrap_or(0));
}

fn hash_selection_filter(key: &mut Vec<u64>, filter: SelectionExtentFilter) {
    match filter {
        SelectionExtentFilter::WholeLayer => key.push(0),
        SelectionExtentFilter::Contours(contour_ids) => {
            key.push(1);
            key.push(u64::try_from(contour_ids.len()).unwrap_or(0));
            for contour_id in &contour_ids {
                for byte in contour_id.as_str().as_bytes() {
                    key.push(u64::from(*byte));
                }
                key.push(TAG_SENTINEL_B);
            }
        }
    }
}

fn hash_layer_tree(
    font: &Font,
    root_glyph_id: GlyphId,
    root_layer_id: LayerId,
    key: &mut Vec<u64>,
) -> crate::CoreResult<()> {
    let mut visited_layers = HashSet::new();
    let mut pending_layers = vec![(root_glyph_id, root_layer_id)];

    while let Some((glyph_id, layer_id)) = pending_layers.pop() {
        if !visited_layers.insert(layer_id) {
            continue;
        }
        key.push(TAG_GLYPH);
        push_glyph_id(key, glyph_id);

        let layer = font.require_layer(layer_id)?;
        let parent_source = layer.source_id();
        hash_glyph_layer(key, layer);
        for component in layer.components_iter() {
            let base_glyph_id = component.base_glyph_id();
            let Some(base_glyph) = font.glyph(base_glyph_id) else {
                continue;
            };
            if let Some(base_layer) = base_glyph
                .layers()
                .values()
                .find(|candidate| candidate.source_id() == parent_source)
            {
                pending_layers.push((base_glyph_id, base_layer.id()));
                continue;
            }
            for base_layer in base_glyph.layers().values() {
                pending_layers.push((base_glyph_id, base_layer.id()));
            }
        }
    }

    Ok(())
}

fn push_glyph_id(key: &mut Vec<u64>, glyph_id: GlyphId) {
    for byte in glyph_id.as_str().as_bytes() {
        key.push(u64::from(*byte));
    }
    key.push(TAG_SENTINEL_C);
}

fn hash_glyph_layer(key: &mut Vec<u64>, layer: &GlyphLayer) {
    key.push(layer.width().to_bits());
    if let Some(height) = layer.height() {
        key.push(1);
        key.push(height.to_bits());
    } else {
        key.push(0);
    }

    for contour in layer.contours_iter() {
        hash_contour(key, contour);
    }

    for component in layer.components_iter() {
        hash_component(key, component);
    }

    if let Some(stroke_lib) = layer.stroke_lib() {
        hash_stroke_lib(key, &stroke_lib);
    }
}

fn hash_contour(key: &mut Vec<u64>, contour: &Contour) {
    key.push(0);
    key.push(u64::from(contour.is_closed()));
    for point in contour.points() {
        key.push(match point.point_type() {
            PointType::OnCurve => 0,
            PointType::OffCurve => 1,
            PointType::QCurve => 2,
        });
        let position = point.position();
        key.push(position.x.to_bits());
        key.push(position.y.to_bits());
    }
    key.push(TAG_CONTOUR_END);
}

fn hash_component(key: &mut Vec<u64>, component: &Component) {
    key.push(1);
    push_glyph_id(key, component.base_glyph_id());
    hash_decomposed_transform(key, component.transform());
}

fn hash_decomposed_transform(key: &mut Vec<u64>, transform: &DecomposedTransform) {
    key.push(transform.translate_x.to_bits());
    key.push(transform.translate_y.to_bits());
    key.push(transform.rotation.to_bits());
    key.push(transform.scale_x.to_bits());
    key.push(transform.scale_y.to_bits());
    key.push(transform.skew_x.to_bits());
    key.push(transform.skew_y.to_bits());
    key.push(transform.t_center_x.to_bits());
    key.push(transform.t_center_y.to_bits());
}

fn hash_stroke_lib(key: &mut Vec<u64>, stroke_lib: &LayerStrokeLib) {
    key.push(2);
    for (contour_id, entry) in &stroke_lib.contours {
        for byte in contour_id.as_bytes() {
            key.push(u64::from(*byte));
        }
        key.push(TAG_SENTINEL_D);
        key.push(match entry.role {
            crate::stroke::layer_lib::ContourStrokeRole::Skeleton => 0,
            crate::stroke::layer_lib::ContourStrokeRole::Outline => 1,
        });
        if let Some(style) = entry.outline_style.as_ref() {
            hash_outline_style(key, style);
        }
        if let Some(style_id) = &entry.style_id {
            for byte in style_id.as_bytes() {
                key.push(u64::from(*byte));
            }
        }
    }
}

fn hash_outline_style(key: &mut Vec<u64>, style: &OutlineStrokeStyle) {
    key.push(style.width.to_bits());
    key.push(cap_tag(style.cap));
    key.push(join_tag(style.join));
    key.push(style.miter_limit.to_bits());
    key.push(style.position.to_bits());
}

fn cap_tag(cap: StrokeCap) -> u64 {
    match cap {
        StrokeCap::Butt => 0,
        StrokeCap::Square => 1,
        StrokeCap::Round => 2,
    }
}

fn join_tag(join: StrokeJoin) -> u64 {
    match join {
        StrokeJoin::Bevel => 0,
        StrokeJoin::Miter => 1,
        StrokeJoin::Round => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SetLiveStroke;
    use crate::stroke::exact_offset::DEFAULT_TOLERANCE;
    use crate::stroke::ink::LayerExtentFallback;
    use crate::stroke::style::OutlineStrokeStyle;
    use crate::test_support::sample_font;
    use crate::{
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, LayerId, MovePoints, PointType,
        SetComponentTransforms,
    };

    fn stroke_test_layer(font: &mut Font, contour: Contour) -> LayerId {
        let glyph_id = GlyphId::from_raw("extent_memo_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("extent_memo_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "extent_memo_glyph".to_string(),
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
    fn point_move_resolves_only_the_moved_contour() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, wavy_skeleton(4, 0.0));
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(wavy_skeleton(4, 200.0));
        layer.add_contour(wavy_skeleton(4, 400.0));
        let contour_ids: Vec<_> = layer.contours_iter().map(Contour::id).collect();
        let moved_point = layer
            .contour(&contour_ids[0])
            .unwrap()
            .points()
            .first()
            .unwrap()
            .id();
        font.replace_glyph_layers(vec![layer]).unwrap();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids,
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        font.layer_extent(layer_id).unwrap();
        let solves = font.ink_measure_runtime().stroke_cache_solves();
        let computes = font.ink_measure_runtime().extent_memo_computes();
        assert!(solves >= 3, "warm read solves every contour once: {solves}");

        // An edit copies the font; the copy must keep the caches, so only the
        // moved contour solves again while the extent itself recomputes.
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![moved_point],
            coords: vec![5.0, 0.0],
        }))
        .unwrap();
        font.layer_extent(layer_id).unwrap();

        assert_eq!(
            font.ink_measure_runtime().extent_memo_computes(),
            computes + 1,
            "the moved layer recomputes its extent once"
        );
        assert_eq!(
            font.ink_measure_runtime().stroke_cache_solves(),
            solves + 1,
            "only the moved contour re-solves"
        );
    }

    #[test]
    fn extent_of_a_curved_stroke_uses_tight_curve_bounds() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, wavy_skeleton(1, 0.0));
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
        }))
        .unwrap();

        // One cubic (0,0) (3,40) (9,-40) (12,20) at width 20: the skeleton's
        // tight top is the end point (y=20) and its tight bottom (y≈-3.22)
        // is a curve interior point below every on-curve point, so the
        // stroke's tight extent is (-10, ≈-13.22, 22, 30). Measuring only
        // on-curve points would give min_y=-10.
        let extent = font.layer_extent(layer_id).unwrap();
        assert!(
            extent.max_y > 29.5 && extent.max_y < 30.5,
            "tight max_y, got {extent:?}"
        );
        assert!(
            extent.min_y > -13.7 && extent.min_y < -12.7,
            "tight min_y from the curve interior, got {extent:?}"
        );
        assert!(
            extent.min_x > -10.5 && extent.min_x < -9.5,
            "stroke radius to the left, got {extent:?}"
        );
    }

    /// One stroked contour of 1,021 points (340 cubics) dragged a point at a
    /// time: every frame re-solves that contour and re-reads the extent.
    /// Run `cargo test --release -p shift-font -- perf_mark` for the timing;
    /// the budget is asserted only in release builds.
    #[test]
    fn perf_mark_dense_contour_drag_frame_stays_in_budget() {
        const RUNS: usize = 21;
        // 10 ms leaves most of a 16.8 ms frame for rendering after the
        // Rust re-solve; the pre-fix cost was ~30 ms per frame.
        const BUDGET: std::time::Duration = std::time::Duration::from_millis(10);

        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, wavy_skeleton(340, 0.0));
        let (contour_id, point_id) = {
            let layer = font.layer(layer_id).unwrap();
            let contour = layer.contours_iter().next().unwrap();
            (contour.id(), contour.points().first().unwrap().id())
        };
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();
        font.layer_extent(layer_id).unwrap();

        let mut times: Vec<_> = (0..RUNS)
            .map(|run| {
                let started = std::time::Instant::now();
                font.apply_intents(&FontIntentSet::from(MovePoints {
                    layer_id,
                    point_ids: vec![point_id.clone()],
                    coords: vec![f64::from(u32::try_from(run).unwrap()), 100.0],
                }))
                .unwrap();
                font.layer_extent(layer_id).unwrap();
                started.elapsed()
            })
            .collect();
        times.sort();
        let median = times[RUNS / 2];

        println!("perf_mark dense contour drag frame, 1,021 points: median {median:?}");
        if cfg!(debug_assertions) {
            return;
        }
        assert!(median <= BUDGET, "median {median:?} exceeds {BUDGET:?}");
    }

    #[test]
    fn second_extent_read_does_not_recompute() {
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
        let after_first = font.ink_measure_runtime().extent_memo_computes();
        font.layer_extent(layer_id).unwrap();
        assert_eq!(
            font.ink_measure_runtime().extent_memo_computes(),
            after_first
        );
    }

    #[test]
    fn point_change_misses_extent_memo() {
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

        font.layer_extent(layer_id).unwrap();
        let key_before = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();

        let end = font
            .layer(layer_id)
            .unwrap()
            .contour(&contour_id)
            .unwrap()
            .points()
            .last()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end],
            coords: vec![100.0, 250.0],
        }))
        .unwrap();

        let key_after = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        assert_ne!(key_before, key_after, "point move must change the key");

        let first_after_move = font.layer_extent(layer_id).unwrap();
        let second_after_move = font.layer_extent(layer_id).unwrap();
        assert!(first_after_move.max_y > 200.0);
        assert_eq!(first_after_move, second_after_move);
    }

    #[test]
    fn measure_switch_misses_extent_memo() {
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
        font.layer_extent(layer_id).unwrap();
        let before = font.ink_measure_runtime().extent_memo_computes();
        font.apply_set_ignore_stroke(true);
        font.layer_extent(layer_id).unwrap();
        assert!(
            font.ink_measure_runtime().extent_memo_computes() > before,
            "measure switch should miss"
        );
    }

    #[test]
    fn stroke_style_change_misses_extent_memo_and_changes_extent() {
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

        let narrow = font.layer_extent(layer_id).unwrap();
        font.layer_extent(layer_id).unwrap();
        let key_before_style = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(50.0),
        }))
        .unwrap();
        let key_after_style = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        assert_ne!(
            key_before_style, key_after_style,
            "style must change the key"
        );

        let wide = font.layer_extent(layer_id).unwrap();
        let wide_again = font.layer_extent(layer_id).unwrap();
        assert!(wide.left_sidebearing() < narrow.left_sidebearing() - 2.0);
        assert_eq!(wide, wide_again);
    }

    #[test]
    fn base_glyph_stroke_width_change_updates_composite_extent() {
        use crate::{Component, CreateGlyph, DecomposedTransform};
        let mut font = sample_font();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::from_raw("memo_base");
        let base_layer = LayerId::from_raw("memo_base_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(base_id),
            name: "memo_base".to_string(),
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
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        let composite_id = GlyphId::from_raw("memo_comp");
        let composite_layer = LayerId::from_raw("memo_comp_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(composite_id),
            name: "memo_comp".to_string(),
            unicodes: vec![],
        }))
        .unwrap();
        font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
            layer_id: composite_layer,
            glyph_id: composite_id,
            source_id,
        }))
        .unwrap();
        let mut comp_layer = font.layer(composite_layer).unwrap().clone();
        comp_layer.add_component(Component::with_transform(
            base_id,
            "memo_base",
            DecomposedTransform::identity(),
        ));
        font.replace_glyph_layers(vec![comp_layer]).unwrap();

        let before_base = font.layer_extent(composite_layer).unwrap();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id: base_layer,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(44.0),
        }))
        .unwrap();
        let after_base = font.layer_extent(composite_layer).unwrap();
        assert!(after_base.max_x > before_base.max_x + 5.0);
    }

    #[test]
    fn failed_extent_recomputes_after_fix() {
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
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: ids.clone(),
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        let bad = ids[1].clone();
        let end = font
            .layer(layer_id)
            .unwrap()
            .contour(&bad)
            .unwrap()
            .points()
            .last()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end.clone()],
            coords: vec![0.0, 400.0],
        }))
        .unwrap();

        let failed = font.layer_extent(layer_id).unwrap();
        assert_eq!(failed.effective, Measure::Skeleton);
        assert!(matches!(
            failed.fallback,
            Some(LayerExtentFallback::StrokeCouldNotBeSolved { .. })
        ));

        font.layer_extent(layer_id).unwrap();
        let cached_failed = font.layer_extent(layer_id).unwrap();
        assert_eq!(cached_failed, failed);

        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end],
            coords: vec![120.0, 400.0],
        }))
        .unwrap();

        let fixed = font.layer_extent(layer_id).unwrap();
        assert_eq!(fixed.effective, Measure::Ink);
        assert!(fixed.fallback.is_none());
    }

    #[test]
    fn extent_key_on_six_hundred_points_stays_under_one_millisecond() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, wavy_skeleton(200, 0.0));
        let points = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .len();
        assert!(points >= 600, "expected ~600 points, got {points}");

        let started = std::time::Instant::now();
        extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        let elapsed = started.elapsed();
        eprintln!("extent key on ~{points} points: {elapsed:?}");
        assert!(
            elapsed.as_micros() < 1_000,
            "key hashing took {elapsed:?}, expected <1 ms"
        );
    }

    #[test]
    fn extent_key_is_stable_for_unchanged_layer() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let first = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        let second = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn extent_key_changes_when_a_point_moves() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, vertical_stem_at(100.0, 200.0));
        let before = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        let end = font
            .layer(layer_id)
            .unwrap()
            .contour(&contour_id)
            .unwrap()
            .points()
            .last()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end],
            coords: vec![100.0, 250.0],
        }))
        .unwrap();
        let after = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        assert_ne!(before, after);
    }

    #[test]
    fn extent_key_mutation_check_style_change_must_alter_key() {
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
        let narrow_key = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();

        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(50.0),
        }))
        .unwrap();
        let wide_key = extent_key(
            &font,
            layer_id,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();

        assert_ne!(
            narrow_key, wide_key,
            "mutation: omitting style from the key would fail here"
        );
    }

    #[test]
    fn component_transform_change_misses_extent_memo() {
        use crate::{Component, CreateGlyph, DecomposedTransform};
        let mut font = sample_font();
        let source_id = font.default_source_id().unwrap();
        let base_id = GlyphId::from_raw("memo_xform_base");
        let base_layer = LayerId::from_raw("memo_xform_base_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(base_id),
            name: "memo_xform_base".to_string(),
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
        stem.add_point(0.0, 0.0, PointType::OnCurve, false);
        stem.add_point(100.0, 0.0, PointType::OnCurve, false);
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
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        let composite_id = GlyphId::from_raw("memo_xform_comp");
        let composite_layer = LayerId::from_raw("memo_xform_comp_layer");
        font.apply_intents(&FontIntentSet::from(CreateGlyph {
            glyph_id: Some(composite_id),
            name: "memo_xform_comp".to_string(),
            unicodes: vec![],
        }))
        .unwrap();
        font.apply_intents(&FontIntentSet::from(CreateGlyphLayer {
            layer_id: composite_layer,
            glyph_id: composite_id,
            source_id,
        }))
        .unwrap();
        let mut comp_layer = font.layer(composite_layer).unwrap().clone();
        comp_layer.add_component(Component::with_transform(
            base_id,
            "memo_xform_base",
            DecomposedTransform::identity(),
        ));
        font.replace_glyph_layers(vec![comp_layer]).unwrap();

        font.layer_extent(composite_layer).unwrap();
        let key_before = extent_key(
            &font,
            composite_layer,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();

        let component_id = font
            .layer(composite_layer)
            .unwrap()
            .components_iter()
            .next()
            .unwrap()
            .id();
        let shifted = DecomposedTransform {
            translate_x: 40.0,
            ..DecomposedTransform::identity()
        };
        font.apply_intents(&FontIntentSet::from(SetComponentTransforms {
            layer_id: composite_layer,
            component_ids: vec![component_id],
            transforms: shifted.to_values().into_iter().collect(),
        }))
        .unwrap();

        let key_after = extent_key(
            &font,
            composite_layer,
            SelectionExtentFilter::WholeLayer,
            Measure::Ink,
            DEFAULT_TOLERANCE,
        )
        .unwrap();
        assert_ne!(key_before, key_after, "transform must change the key");

        let moved = font.layer_extent(composite_layer).unwrap();
        let moved_again = font.layer_extent(composite_layer).unwrap();
        assert_eq!(moved, moved_again);
    }
}
