//! Non-destructive constant-width strokes (stream A2): lib metadata + read-time outlines.

use kurbo::{BezPath, PathEl};

use crate::contour::SubpathPoints;
use crate::{Contour, ContourId, CoreError, CoreResult, GlyphLayer, Require, SegmentIndexIter};

use super::exact_offset::{self, path_bbox};
use super::layer_edit::{contour_skeleton_path, install_path_contours};
use super::layer_lib::{
    ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, sync_stroke_lib_on_layer,
};
use super::solve_cache::{SolvedOutline, StrokeOutlineCache};
use super::style::OutlineStrokeStyle;

/// One skeleton contour and the fill outlines computed from it at read time.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokeOutlinePreview {
    pub skeleton_contour_id: ContourId,
    pub outlines: Vec<Contour>,
}

/// One skeleton contour and its fill outlines as plain points, with no ids.
///
/// The same outlines as [`StrokeOutlinePreview`], for a reader that only
/// draws or sends them. Minting an id for every outline point costs several
/// times the stroke solve, so a read repeated every frame of a drag takes this.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokeOutlinePoints {
    pub skeleton_contour_id: ContourId,
    /// The largest width of any outline, in font units, as [`preview_bounds`] measures it.
    pub width: f64,
    /// The largest height of any outline, in font units, as [`preview_bounds`] measures it.
    pub height: f64,
    /// Union of the outlines' bounds as `(min_x, min_y, max_x, max_y)`,
    /// measured when the outline was solved.
    pub bounds: (f64, f64, f64, f64),
    pub outlines: Vec<SubpathPoints>,
}

/// A live skeleton that could not be solved, and why.
#[derive(Debug)]
pub struct StrokeContourFailure {
    pub skeleton_contour_id: ContourId,
    pub error: CoreError,
}

/// What reading a layer's live strokes found: the outline of every skeleton
/// that solved, and each one that did not.
///
/// One skeleton that cannot be solved never hides the others' outlines, so a
/// reader draws what solved and says why the rest did not.
#[derive(Debug, Default)]
pub struct StrokeOutlineRead {
    pub solved: Vec<StrokeOutlinePoints>,
    /// Skeletons that failed, geometry failures before solver failures, each group in contour id order.
    pub failed: Vec<StrokeContourFailure>,
}

/// A contour carrying a live stroke and the style it is stroked in.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct LiveStroke {
    pub contour_id: ContourId,
    pub style: OutlineStrokeStyle,
}

/// A contour carrying a live stroke, with the style it is stroked in.
struct LiveSkeleton<'a> {
    id: ContourId,
    contour: &'a Contour,
    style: OutlineStrokeStyle,
}

/// The contours of a layer that carry a live stroke, split by whether their geometry can be solved.
struct LiveSkeletons<'a> {
    solvable: Vec<LiveSkeleton<'a>>,
    unsolvable: Vec<StrokeContourFailure>,
}

impl<'a> LiveSkeletons<'a> {
    /// Every skeleton, for a caller that needs all of them or none.
    ///
    /// # Errors
    ///
    /// Returns the first skeleton's error when any cannot be solved.
    fn require_all(self) -> CoreResult<Vec<LiveSkeleton<'a>>> {
        match self.unsolvable.into_iter().next() {
            Some(failure) => Err(failure.error),
            None => Ok(self.solvable),
        }
    }
}

impl GlyphLayer {
    /// Marks contours as live stroke skeletons and stores `style` in `com.shift.stroke`.
    ///
    /// Geometry stays editable; call [`Self::stroke_outlines_for_preview`] to derive fills.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ContourNotFound`] when a contour id is missing, and
    /// [`CoreError::StrokeOperationFailed`] when `style.width` is invalid.
    pub fn set_live_stroke_contours(
        &mut self,
        contour_ids: &[ContourId],
        style: OutlineStrokeStyle,
    ) -> CoreResult<()> {
        style.require_valid()?;

        let mut stroke_lib = self.stroke_lib().unwrap_or_else(|| LayerStrokeLib {
            contours: Default::default(),
        });

        for contour_id in contour_ids {
            self.contour(contour_id).require(contour_id)?;
            stroke_lib.contours.insert(
                contour_id.to_string(),
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: None,
                    outline_style: Some(style),
                },
            );
        }

        self.set_stroke_lib(&stroke_lib);
        Ok(())
    }

    /// Contours carrying a live stroke: a skeleton entry with a stored style.
    ///
    /// These are the contours [`Self::stroke_outlines_for_preview`] solves and
    /// [`Self::bake_stroke_outlines`] accepts. Answering this solves nothing.
    /// Ids follow contour order on the layer.
    pub fn live_stroke_contour_ids(&self) -> Vec<ContourId> {
        self.live_strokes()
            .into_iter()
            .map(|stroke| stroke.contour_id)
            .collect()
    }

    /// The contours carrying a live stroke, each with the style stored for it.
    ///
    /// Answering this solves nothing. Ids follow contour order on the layer.
    pub fn live_strokes(&self) -> Vec<LiveStroke> {
        let Some(stroke_lib) = self.stroke_lib() else {
            return Vec::new();
        };

        self.contours_iter()
            .filter_map(|contour| {
                let entry = stroke_lib.contours.get(&contour.id().to_string())?;
                if entry.role != ContourStrokeRole::Skeleton {
                    return None;
                }

                Some(LiveStroke {
                    contour_id: contour.id(),
                    style: entry.outline_style?,
                })
            })
            .collect()
    }

    /// Drops the live stroke from each listed contour, keeping the contours.
    ///
    /// The `com.shift.stroke` lib key is removed once no entries remain.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokeOperationFailed`] when a listed contour has no live stroke,
    /// and [`CoreError::ContourNotFound`] when a contour id is missing.
    pub fn remove_live_stroke_contours(&mut self, contour_ids: &[ContourId]) -> CoreResult<()> {
        let mut stroke_lib = self
            .stroke_lib()
            .ok_or_else(|| CoreError::StrokeOperationFailed {
                message: "layer has no live stroke metadata".to_string(),
            })?;
        let live = self.live_stroke_contour_ids();

        for contour_id in contour_ids {
            self.contour(contour_id).require(contour_id)?;
            if !live.contains(contour_id) {
                return Err(CoreError::StrokeOperationFailed {
                    message: format!("contour {contour_id} has no live stroke"),
                });
            }
            stroke_lib.contours.remove(&contour_id.to_string());
        }

        sync_stroke_lib_on_layer(self, &stroke_lib);
        Ok(())
    }

    /// Computes stroke fill outlines for every live skeleton on this layer.
    ///
    /// Results are ephemeral: they are not stored on the layer until
    /// [`Self::bake_stroke_outlines`]. Each outline point carries a minted
    /// id; a reader that only draws them takes
    /// [`Self::stroke_outline_points_for_preview`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokeOperationFailed`] when tolerance or a stored style is invalid,
    /// or when the solver returns nothing.
    pub fn stroke_outlines_for_preview(
        &self,
        tolerance: f64,
    ) -> CoreResult<Vec<StrokeOutlinePreview>> {
        self.live_stroke_outline_paths(tolerance)?
            .into_iter()
            .map(|(skeleton_contour_id, path)| {
                let outlines = subpaths_of_outline_path(&path)?
                    .into_iter()
                    .map(Contour::from)
                    .collect();
                Ok(StrokeOutlinePreview {
                    skeleton_contour_id,
                    outlines,
                })
            })
            .collect()
    }

    /// Computes the same fill outlines as [`Self::stroke_outlines_for_preview`]
    /// as plain points: no `Contour` or id is built.
    ///
    /// Ephemeral, as there. Points, point types, closure and bounds match the
    /// contour form exactly. Every skeleton is solved; a reader repeated
    /// every frame takes [`Self::stroke_outline_points_for_preview_with`].
    /// A skeleton that cannot be solved is reported in
    /// [`StrokeOutlineRead::failed`] and does not stop the others.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokeOperationFailed`] when `tolerance` is not a
    /// finite value greater than zero.
    pub fn stroke_outline_points_for_preview(
        &self,
        tolerance: f64,
    ) -> CoreResult<StrokeOutlineRead> {
        self.stroke_outline_points_for_preview_with(
            tolerance,
            &mut StrokeOutlineCache::with_capacity(0),
        )
    }

    /// As [`Self::stroke_outline_points_for_preview`], taking each skeleton's
    /// outline from `cache` when its geometry, style and `tolerance` are
    /// those it solved before, and solving, then storing, the rest.
    ///
    /// The answer is the same with any cache, empty or full. A failure is
    /// never stored, so a skeleton that cannot be solved is tried again.
    ///
    /// # Errors
    ///
    /// As [`Self::stroke_outline_points_for_preview`].
    pub fn stroke_outline_points_for_preview_with(
        &self,
        tolerance: f64,
        cache: &mut StrokeOutlineCache,
    ) -> CoreResult<StrokeOutlineRead> {
        let LiveSkeletons {
            solvable,
            mut unsolvable,
        } = self.live_skeletons(tolerance)?;

        let mut solved = Vec::with_capacity(solvable.len());
        for skeleton in solvable {
            match solve_skeleton(&skeleton, tolerance, cache) {
                Ok(points) => solved.push(points),
                Err(error) => unsolvable.push(StrokeContourFailure {
                    skeleton_contour_id: skeleton.id,
                    error,
                }),
            }
        }

        Ok(StrokeOutlineRead {
            solved,
            failed: unsolvable,
        })
    }

    /// Each live skeleton's id with the fill path the solver draws for it.
    fn live_stroke_outline_paths(&self, tolerance: f64) -> CoreResult<Vec<(ContourId, BezPath)>> {
        Ok(self
            .live_skeletons(tolerance)?
            .require_all()?
            .into_iter()
            .map(|skeleton| {
                let skeleton_path = contour_skeleton_path(skeleton.contour);
                let outline =
                    exact_offset::outline(&skeleton_path, &skeleton.style.to_exact(), tolerance);
                (skeleton.id, outline)
            })
            .collect())
    }

    /// The contours of this layer that carry a live stroke, with their styles,
    /// split by whether each has geometry the solver can take.
    fn live_skeletons(&self, tolerance: f64) -> CoreResult<LiveSkeletons<'_>> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "tolerance must be a finite value greater than zero".to_string(),
            });
        }

        let Some(stroke_lib) = self.stroke_lib() else {
            return Ok(LiveSkeletons {
                solvable: Vec::new(),
                unsolvable: Vec::new(),
            });
        };

        let mut skeletons = LiveSkeletons {
            solvable: Vec::new(),
            unsolvable: Vec::new(),
        };
        for (contour_id, entry) in &stroke_lib.contours {
            if entry.role != ContourStrokeRole::Skeleton {
                continue;
            }
            let Some(style) = entry.outline_style else {
                continue;
            };
            let id = ContourId::from_raw(contour_id);
            let contour = match self.contour(&id).require(&id) {
                Ok(contour) => contour,
                Err(error) => {
                    skeletons.unsolvable.push(StrokeContourFailure {
                        skeleton_contour_id: id,
                        error,
                    });
                    continue;
                }
            };
            if let Err(error) = super::layer_edit::require_stroke_geometry(contour) {
                skeletons.unsolvable.push(StrokeContourFailure {
                    skeleton_contour_id: id,
                    error,
                });
                continue;
            }
            skeletons.solvable.push(LiveSkeleton { id, contour, style });
        }

        Ok(skeletons)
    }

    /// Replaces live skeleton contours with baked fill outlines and drops their stroke lib entries.
    ///
    /// Styles are read from [`com.shift.stroke`](super::layer_lib::STROKE_LIB_KEY).
    ///
    /// # Errors
    ///
    /// Same errors as [`Self::outline_stroke_contours`],
    /// plus missing live stroke metadata on a listed contour.
    pub fn bake_stroke_outlines(
        &mut self,
        contour_ids: &[ContourId],
        tolerance: f64,
    ) -> CoreResult<Vec<ContourId>> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "tolerance must be a finite value greater than zero".to_string(),
            });
        }

        let stroke_lib = self
            .stroke_lib()
            .ok_or_else(|| CoreError::StrokeOperationFailed {
                message: "layer has no live stroke metadata".to_string(),
            })?;

        let mut created = Vec::new();
        for contour_id in contour_ids {
            let entry = stroke_lib
                .contours
                .get(&contour_id.to_string())
                .ok_or_else(|| CoreError::StrokeOperationFailed {
                    message: format!("contour {contour_id} has no live stroke entry"),
                })?;
            if entry.role != ContourStrokeRole::Skeleton {
                return Err(CoreError::StrokeOperationFailed {
                    message: format!("contour {contour_id} is not a stroke skeleton"),
                });
            }
            let style = entry
                .outline_style
                .ok_or_else(|| CoreError::StrokeOperationFailed {
                    message: format!("contour {contour_id} has no outline style"),
                })?;

            let contour = self.contour(contour_id).require(contour_id)?.clone();
            let skeleton = contour_skeleton_path(&contour);
            let outline = exact_offset::outline(&skeleton, &style.to_exact(), tolerance);

            self.remove_contour_checked(contour_id)?;
            created.extend(install_path_contours(self, &outline)?);
        }

        Ok(created)
    }
}

/// `skeleton`'s outline as plain points, from `cache` when it solved the same input before.
fn solve_skeleton(
    skeleton: &LiveSkeleton<'_>,
    tolerance: f64,
    cache: &mut StrokeOutlineCache,
) -> CoreResult<StrokeOutlinePoints> {
    let path = contour_skeleton_path(skeleton.contour);
    let style = skeleton.style.to_exact();
    let solved = cache.outline(&path, &style, tolerance, || {
        let outline = exact_offset::outline(&path, &style, tolerance);
        let (width, height) = outline_extent(&outline);
        let outlines = subpaths_of_outline_path(&outline)?;
        // Measured here, once per solve, so a cached read unions bounds
        // instead of re-measuring every outline point. Segment bounds over
        // the solved points give the same tight box the resolved contours
        // would — without rebuilding contours (and minting a fresh point
        // id) per point, which cost more than the solve itself.
        let bounds = outlines.iter().fold(None, |union, subpath| {
            let position = |index: usize| {
                (
                    subpath.coordinates[2 * index],
                    subpath.coordinates[2 * index + 1],
                )
            };
            SegmentIndexIter::new(subpath.point_types.as_slice(), subpath.closed)
                .map(|segment| segment.bounds(position))
                .fold(union, |union: Option<(f64, f64, f64, f64)>, bounds| {
                    Some(match union {
                        None => bounds,
                        Some((min_x, min_y, max_x, max_y)) => (
                            min_x.min(bounds.0),
                            min_y.min(bounds.1),
                            max_x.max(bounds.2),
                            max_y.max(bounds.3),
                        ),
                    })
                })
        });
        let bounds = bounds.unwrap_or((0.0, 0.0, 0.0, 0.0));
        Ok(SolvedOutline {
            width,
            height,
            bounds,
            outlines,
        })
    })?;

    Ok(StrokeOutlinePoints {
        skeleton_contour_id: skeleton.id.clone(),
        width: solved.width,
        height: solved.height,
        bounds: solved.bounds,
        outlines: solved.outlines,
    })
}

/// The subpaths of the solver's `path`, which must hold at least one.
fn subpaths_of_outline_path(path: &BezPath) -> CoreResult<Vec<SubpathPoints>> {
    if path.elements().is_empty() {
        return Err(CoreError::StrokeOperationFailed {
            message: "solver produced an empty path".to_string(),
        });
    }

    let subpaths = SubpathPoints::of_path(path);
    if subpaths.is_empty() {
        return Err(CoreError::StrokeOperationFailed {
            message: "solver produced no contours".to_string(),
        });
    }

    Ok(subpaths)
}

/// The largest width and height across the subpaths of `path`: what
/// [`preview_bounds`] measures from the same outlines as contours.
fn outline_extent(path: &BezPath) -> (f64, f64) {
    let mut width: f64 = 0.0;
    let mut height: f64 = 0.0;
    let mut widen = |subpath: &BezPath| {
        let bbox = path_bbox(subpath);
        width = width.max(bbox.width());
        height = height.max(bbox.height());
    };

    let mut subpath = BezPath::new();
    for element in path.elements() {
        if matches!(element, PathEl::MoveTo(_)) {
            widen(&subpath);
            subpath = BezPath::new();
        }
        subpath.push(*element);
    }
    widen(&subpath);

    (width, height)
}

/// Preview bounding box for tests and CLI: max width/height across outline contours.
pub fn preview_bounds(preview: &StrokeOutlinePreview) -> (f64, f64) {
    let mut max_width: f64 = 0.0;
    let mut max_height: f64 = 0.0;
    for contour in &preview.outlines {
        let path = contour_skeleton_path(contour);
        let bbox = path_bbox(&path);
        max_width = max_width.max(bbox.width());
        max_height = max_height.max(bbox.height());
    }
    (max_width, max_height)
}

#[cfg(test)]
mod tests {
    use crate::stroke::{
        ContourStrokeEntry, ContourStrokeRole, DEFAULT_TOLERANCE, LayerStrokeLib,
        OutlineStrokeStyle, StrokeCap, StrokeJoin,
    };
    use crate::test_support::{apply_undo_redo, sample_font};
    use crate::{
        BakeStrokeOutlines, Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId,
        LayerId, MovePoints, PointType, RemoveLiveStroke, SetLiveStroke,
    };

    use super::*;

    fn stroke_test_layer(font: &mut crate::Font, contour: Contour) -> LayerId {
        let glyph_id = GlyphId::from_raw("live_stroke_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("live_stroke_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "live_stroke_glyph".to_string(),
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

    #[test]
    fn moving_skeleton_points_changes_preview_outlines() {
        let mut font = sample_font();
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        let layer_id = stroke_test_layer(&mut font, contour);
        let layer = font.layer(layer_id).unwrap();
        let contour_id = layer.contours_iter().next().unwrap().id();

        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(20.0),
        }))
        .unwrap();

        let before = font
            .layer(layer_id)
            .unwrap()
            .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
            .unwrap();
        assert_eq!(before.len(), 1);
        let (w0, h0) = preview_bounds(&before[0]);

        let point_id = font
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
            point_ids: vec![point_id],
            coords: vec![200.0, 0.0],
        }))
        .unwrap();

        let after = font
            .layer(layer_id)
            .unwrap()
            .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
            .unwrap();
        let (w1, _) = preview_bounds(&after[0]);
        assert!(w1 > w0, "longer skeleton should widen the preview outline");
        assert!(h0 > 0.0);
    }

    /// An open cubic skeleton along x, `cubics` curves long, starting at `y`.
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

    fn closed_triangle(y: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, y, PointType::OnCurve, false);
        contour.add_point(120.0, y, PointType::OnCurve, false);
        contour.add_point(60.0, y + 90.0, PointType::OnCurve, false);
        contour.close();
        contour
    }

    /// A layer holding `contours`, every one a live stroke at `style`.
    fn layer_with_live_strokes(
        font: &mut crate::Font,
        contours: Vec<Contour>,
        style: OutlineStrokeStyle,
    ) -> LayerId {
        let ids: Vec<_> = contours.iter().map(Contour::id).collect();
        let mut layer_id = None;
        for contour in contours {
            layer_id = Some(stroke_test_layer(font, contour));
        }
        let layer_id = layer_id.unwrap();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: ids,
            style,
        }))
        .unwrap();
        layer_id
    }

    #[test]
    fn preview_points_equal_the_preview_contours_for_every_join_and_closure() {
        let miter = OutlineStrokeStyle {
            join: StrokeJoin::Miter,
            ..OutlineStrokeStyle::round(24.0)
        };
        for style in [OutlineStrokeStyle::round(20.0), miter] {
            let mut font = sample_font();
            let layer_id = layer_with_live_strokes(
                &mut font,
                vec![wavy_skeleton(5, 0.0), closed_triangle(300.0)],
                style,
            );
            let layer = font.layer(layer_id).unwrap();

            let contours = layer
                .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
                .unwrap();
            let points = layer
                .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
                .unwrap()
                .solved;

            assert_eq!(points.len(), 2);
            for (from_contours, from_points) in contours.iter().zip(&points) {
                assert_eq!(
                    from_points.skeleton_contour_id,
                    from_contours.skeleton_contour_id
                );
                assert_eq!(
                    (from_points.width, from_points.height),
                    preview_bounds(from_contours)
                );
                assert_eq!(from_points.outlines.len(), from_contours.outlines.len());
                for (subpath, contour) in from_points.outlines.iter().zip(&from_contours.outlines) {
                    assert_eq!(subpath.closed, contour.is_closed());
                    assert_eq!(
                        subpath.point_types,
                        contour
                            .points()
                            .iter()
                            .map(crate::Point::point_type)
                            .collect::<Vec<_>>()
                    );
                    assert_eq!(
                        subpath.coordinates,
                        contour
                            .points()
                            .iter()
                            .flat_map(|point| [point.x(), point.y()])
                            .collect::<Vec<_>>()
                    );
                }
            }
        }
    }

    #[test]
    fn preview_points_of_a_layer_without_a_live_stroke_are_empty() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, closed_triangle(0.0));

        let points = font
            .layer(layer_id)
            .unwrap()
            .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
            .unwrap()
            .solved;

        assert!(points.is_empty());
    }

    #[test]
    fn preview_points_refuse_a_tolerance_that_is_not_positive_and_finite() {
        let mut font = sample_font();
        let layer_id = layer_with_live_strokes(
            &mut font,
            vec![closed_triangle(0.0)],
            OutlineStrokeStyle::round(20.0),
        );
        let layer = font.layer(layer_id).unwrap();

        for tolerance in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(layer.stroke_outline_points_for_preview(tolerance).is_err());
            assert!(layer.stroke_outlines_for_preview(tolerance).is_err());
        }
    }

    /// An open skeleton of two points, `length` apart along x.
    fn two_point_skeleton(length: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, 400.0, PointType::OnCurve, false);
        contour.add_point(length, 400.0, PointType::OnCurve, false);
        contour
    }

    /// A layer of a triangle and a two-point skeleton, both live strokes, then the
    /// second point dragged onto the first so the solver has nothing to outline.
    /// Returns the layer, the triangle's id, and the collapsed skeleton's id.
    fn layer_with_a_collapsed_skeleton(font: &mut crate::Font) -> (LayerId, ContourId, ContourId) {
        let layer_id = layer_with_live_strokes(
            font,
            vec![closed_triangle(0.0), two_point_skeleton(100.0)],
            OutlineStrokeStyle::round(20.0),
        );
        let layer = font.layer(layer_id).unwrap();
        let ids: Vec<_> = layer.contours_iter().map(Contour::id).collect();
        let (good, bad) = (ids[0].clone(), ids[1].clone());
        let end = last_point_of(font, layer_id, &bad);
        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![end],
            coords: vec![0.0, 400.0],
        }))
        .unwrap();
        (layer_id, good, bad)
    }

    #[test]
    fn a_skeleton_the_solver_cannot_outline_is_reported_beside_the_ones_that_solved() {
        let mut font = sample_font();
        let (layer_id, good, bad) = layer_with_a_collapsed_skeleton(&mut font);

        let read = font
            .layer(layer_id)
            .unwrap()
            .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
            .unwrap();

        let solved: Vec<_> = read.solved.iter().map(|o| &o.skeleton_contour_id).collect();
        let failed: Vec<_> = read.failed.iter().map(|f| &f.skeleton_contour_id).collect();
        assert_eq!(solved, vec![&good]);
        assert_eq!(failed, vec![&bad]);
    }

    #[test]
    fn a_skeleton_left_without_geometry_is_reported_beside_the_ones_that_solved() {
        let mut font = sample_font();
        let layer_id = layer_with_live_strokes(
            &mut font,
            vec![closed_triangle(0.0), closed_triangle(300.0)],
            OutlineStrokeStyle::round(20.0),
        );
        let layer = font.layer(layer_id).unwrap();
        let ids: Vec<_> = layer.contours_iter().map(Contour::id).collect();
        let (good, bad) = (ids[0].clone(), ids[1].clone());
        let points: Vec<_> = layer
            .contour(&bad)
            .unwrap()
            .points()
            .iter()
            .map(crate::ir::point::Point::id)
            .collect();
        font.apply_intents(&FontIntentSet::from(crate::RemovePoints {
            layer_id,
            point_ids: points[1..].to_vec(),
        }))
        .unwrap();

        let read = font
            .layer(layer_id)
            .unwrap()
            .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
            .unwrap();

        assert_eq!(read.solved.len(), 1);
        assert_eq!(read.solved[0].skeleton_contour_id, good);
        assert_eq!(read.failed.len(), 1);
        assert_eq!(read.failed[0].skeleton_contour_id, bad);
    }

    #[test]
    fn whole_layer_readers_still_fail_when_any_skeleton_cannot_be_solved() {
        let mut font = sample_font();
        let (layer_id, _, _) = layer_with_a_collapsed_skeleton(&mut font);
        let layer = font.layer(layer_id).unwrap();

        assert!(
            layer
                .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
                .is_err()
        );
    }

    /// The point of `contour_id`'s last skeleton point, to drag it.
    fn last_point_of(
        font: &crate::Font,
        layer_id: LayerId,
        contour_id: &ContourId,
    ) -> crate::PointId {
        font.layer(layer_id)
            .unwrap()
            .contour(contour_id)
            .unwrap()
            .points()
            .last()
            .unwrap()
            .id()
    }

    /// Three live skeletons on one layer and their contour ids, in layer order.
    fn three_skeletons(font: &mut crate::Font) -> (LayerId, Vec<ContourId>) {
        let layer_id = layer_with_live_strokes(
            font,
            vec![
                wavy_skeleton(5, 0.0),
                wavy_skeleton(5, 150.0),
                closed_triangle(300.0),
            ],
            OutlineStrokeStyle::round(20.0),
        );
        let ids = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .map(Contour::id)
            .collect();
        (layer_id, ids)
    }

    /// `contour_id`'s outline in `points`, which come back in contour id order.
    fn outline_of<'a>(
        points: &'a [StrokeOutlinePoints],
        contour_id: &ContourId,
    ) -> &'a StrokeOutlinePoints {
        points
            .iter()
            .find(|outline| &outline.skeleton_contour_id == contour_id)
            .unwrap()
    }

    fn point_count(outline: &StrokeOutlinePoints) -> usize {
        outline.outlines.iter().map(|s| s.point_types.len()).sum()
    }

    #[test]
    fn a_cached_read_returns_what_an_uncached_read_returns() {
        let miter = OutlineStrokeStyle {
            join: StrokeJoin::Miter,
            ..OutlineStrokeStyle::round(24.0)
        };
        for style in [OutlineStrokeStyle::round(20.0), miter] {
            let mut font = sample_font();
            let layer_id = layer_with_live_strokes(
                &mut font,
                vec![wavy_skeleton(5, 0.0), closed_triangle(300.0)],
                style,
            );
            let layer = font.layer(layer_id).unwrap();
            let mut cache = StrokeOutlineCache::default();

            let uncached = layer
                .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
                .unwrap()
                .solved;
            let cold = layer
                .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
                .unwrap()
                .solved;
            let warm = layer
                .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
                .unwrap()
                .solved;

            assert!(cold == uncached);
            assert!(warm == uncached);
        }
    }

    #[test]
    fn a_second_read_of_an_unchanged_layer_solves_nothing() {
        let mut font = sample_font();
        let (layer_id, _) = three_skeletons(&mut font);
        let layer = font.layer(layer_id).unwrap();
        let mut cache = StrokeOutlineCache::default();

        layer
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap();
        assert_eq!(cache.solves(), 3);
        layer
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap();

        assert_eq!(cache.solves(), 3);
    }

    #[test]
    fn moving_one_point_solves_only_the_contour_it_belongs_to() {
        let mut font = sample_font();
        let (layer_id, ids) = three_skeletons(&mut font);
        let mut cache = StrokeOutlineCache::default();
        let before = font
            .layer(layer_id)
            .unwrap()
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap()
            .solved;
        let point_id = last_point_of(&font, layer_id, &ids[1]);

        font.apply_intents(&FontIntentSet::from(MovePoints {
            layer_id,
            point_ids: vec![point_id],
            coords: vec![400.0, 150.0],
        }))
        .unwrap();
        let after = font
            .layer(layer_id)
            .unwrap()
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap()
            .solved;

        assert_eq!(cache.solves(), 4, "only the moved contour solved again");
        assert!(outline_of(&after, &ids[0]) == outline_of(&before, &ids[0]));
        assert!(
            outline_of(&after, &ids[1]) != outline_of(&before, &ids[1]),
            "the moved contour's outline changed"
        );
        assert!(outline_of(&after, &ids[2]) == outline_of(&before, &ids[2]));
    }

    #[test]
    fn a_changed_style_or_tolerance_is_not_answered_from_an_older_solve() {
        let mut font = sample_font();
        let (layer_id, ids) = three_skeletons(&mut font);
        let mut cache = StrokeOutlineCache::default();
        let read = |font: &crate::Font, tolerance: f64, cache: &mut StrokeOutlineCache| {
            font.layer(layer_id)
                .unwrap()
                .stroke_outline_points_for_preview_with(tolerance, cache)
                .unwrap()
                .solved
        };
        let before = read(&font, DEFAULT_TOLERANCE, &mut cache);

        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![ids[0].clone()],
            style: OutlineStrokeStyle::round(40.0),
        }))
        .unwrap();
        let wider = read(&font, DEFAULT_TOLERANCE, &mut cache);
        let finer = read(&font, DEFAULT_TOLERANCE / 4.0, &mut cache);

        assert_eq!(
            cache.solves(),
            3 + 1 + 3,
            "the restyled contour, then every contour at a new tolerance"
        );
        assert!(
            outline_of(&wider, &ids[0]).height > outline_of(&before, &ids[0]).height + 10.0,
            "the restyled contour is wider"
        );
        assert!(outline_of(&wider, &ids[1]) == outline_of(&before, &ids[1]));
        assert!(
            point_count(outline_of(&finer, &ids[1])) > point_count(outline_of(&before, &ids[1])),
            "a finer tolerance flattens into more points"
        );
    }

    #[test]
    fn every_style_field_keys_the_cache() {
        let mut font = sample_font();
        let (layer_id, ids) = three_skeletons(&mut font);
        let mut cache = StrokeOutlineCache::default();
        let styles = [
            OutlineStrokeStyle::round(20.0),
            OutlineStrokeStyle {
                cap: StrokeCap::Butt,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                cap: StrokeCap::Square,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                join: StrokeJoin::Miter,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                join: StrokeJoin::Miter,
                miter_limit: 1.0,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                join: StrokeJoin::Bevel,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                position: -0.5,
                ..OutlineStrokeStyle::round(20.0)
            },
            OutlineStrokeStyle {
                position: 1.0,
                ..OutlineStrokeStyle::round(20.0)
            },
        ];

        // Each style changes a field the one before did not, on a cache that
        // has seen all the earlier ones.
        for style in styles {
            font.apply_intents(&FontIntentSet::from(SetLiveStroke {
                layer_id,
                contour_ids: ids.clone(),
                style,
            }))
            .unwrap();
            let layer = font.layer(layer_id).unwrap();

            let cached = layer
                .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
                .unwrap()
                .solved;
            let fresh = layer
                .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
                .unwrap()
                .solved;

            assert!(
                cached == fresh,
                "{style:?} answered from another style's solve"
            );
        }
    }

    #[test]
    fn a_cache_holds_a_bounded_number_of_points_and_drops_the_least_recently_used() {
        let mut font = sample_font();
        let (layer_id, ids) = three_skeletons(&mut font);
        let layer = font.layer(layer_id).unwrap();
        let one = layer
            .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
            .unwrap()
            .solved;
        // Room for the two wavy outlines, not for the triangle's as well.
        let room = point_count(outline_of(&one, &ids[0])) + point_count(outline_of(&one, &ids[1]));
        let mut cache = StrokeOutlineCache::with_capacity(room);

        layer
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap();
        assert_eq!(cache.solves(), 3);
        assert!(cache.points() <= room);
        layer
            .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
            .unwrap();

        assert!(
            cache.solves() > 3,
            "the first outline was dropped to make room and solved again"
        );
        assert!(cache.points() <= room);
    }

    #[test]
    fn a_cache_with_no_room_stores_nothing() {
        let mut font = sample_font();
        let (layer_id, _) = three_skeletons(&mut font);
        let layer = font.layer(layer_id).unwrap();
        let mut cache = StrokeOutlineCache::with_capacity(0);

        for _ in 0..2 {
            layer
                .stroke_outline_points_for_preview_with(DEFAULT_TOLERANCE, &mut cache)
                .unwrap();
        }

        assert_eq!(cache.solves(), 6);
        assert_eq!(cache.points(), 0);
    }

    /// Reading a live stroke's outline costs about what solving it costs, not
    /// what minting an id for every outline point costs (about six times the
    /// solve). Run `cargo test --release -p shift-font -- perf_mark` for the
    /// timing; the budget is asserted only in release builds.
    #[test]
    fn perf_mark_stroke_preview_points_cost_what_the_solver_costs() {
        const RUNS: usize = 21;
        const BUDGET: std::time::Duration = std::time::Duration::from_millis(8);

        let mut font = sample_font();
        let skeletons = (0..5)
            .map(|index| wavy_skeleton(67, f64::from(index) * 120.0))
            .collect();
        let layer_id =
            layer_with_live_strokes(&mut font, skeletons, OutlineStrokeStyle::round(20.0));
        let layer = font.layer(layer_id).unwrap();

        let mut times: Vec<_> = (0..RUNS)
            .map(|_| {
                let started = std::time::Instant::now();
                let points = layer
                    .stroke_outline_points_for_preview(DEFAULT_TOLERANCE)
                    .unwrap()
                    .solved;
                let elapsed = started.elapsed();
                assert_eq!(points.len(), 5);
                elapsed
            })
            .collect();
        times.sort();
        let median = times[RUNS / 2];

        println!("perf_mark stroke preview points, 5 contours of 67 cubics: median {median:?}");
        if cfg!(debug_assertions) {
            return;
        }
        assert!(median <= BUDGET, "median {median:?} exceeds {BUDGET:?}");
    }

    #[test]
    fn live_stroke_style_round_trips_through_layer_lib() {
        let style = OutlineStrokeStyle {
            width: 24.0,
            cap: StrokeCap::Square,
            join: StrokeJoin::Miter,
            miter_limit: 8.0,
            position: -0.25,
        };
        let lib = LayerStrokeLib {
            contours: std::collections::BTreeMap::from([(
                "c1".to_string(),
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: None,
                    outline_style: Some(style),
                },
            )]),
        };
        let restored =
            LayerStrokeLib::from_lib(&lib.to_lib()).expect("stroke lib should round-trip");
        assert_eq!(restored.contours["c1"].outline_style, Some(style));
    }

    fn first_contour_id(font: &crate::Font, layer_id: LayerId) -> ContourId {
        font.layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id()
    }

    fn two_point_contour(end_x: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(end_x, 0.0, PointType::OnCurve, false);
        contour
    }

    #[test]
    fn remove_live_stroke_clears_the_entry_and_keeps_the_contour() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, two_point_contour(80.0));
        let contour_id = first_contour_id(&font, layer_id);
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(16.0),
        }))
        .unwrap();
        let before_remove = font.clone();

        let applied = font
            .apply_intents(&FontIntentSet::from(RemoveLiveStroke {
                layer_id,
                contour_ids: vec![contour_id.clone()],
            }))
            .unwrap();

        let layer = font.layer(layer_id).unwrap();
        assert!(layer.contour(&contour_id).is_some(), "contour stays");
        assert!(layer.stroke_lib().is_none(), "empty lib key is dropped");
        assert!(layer.live_stroke_contour_ids().is_empty());
        assert!(
            layer
                .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
                .unwrap()
                .is_empty(),
            "no preview outline once the stroke is removed"
        );

        font.apply_change_set(&applied.changes.inverted()).unwrap();
        assert_eq!(font, before_remove, "one undo restores the dynamic stroke");
    }

    #[test]
    fn remove_live_stroke_leaves_other_dynamic_contours_alone() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, two_point_contour(80.0));
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(two_point_contour(40.0));
        font.replace_glyph_layers(vec![layer]).unwrap();
        let ids: Vec<ContourId> = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .map(Contour::id)
            .collect();
        font.apply_intents(&FontIntentSet::from(SetLiveStroke {
            layer_id,
            contour_ids: ids.clone(),
            style: OutlineStrokeStyle::round(16.0),
        }))
        .unwrap();

        font.apply_intents(&FontIntentSet::from(RemoveLiveStroke {
            layer_id,
            contour_ids: vec![ids[0].clone()],
        }))
        .unwrap();

        let layer = font.layer(layer_id).unwrap();
        assert_eq!(layer.live_stroke_contour_ids(), vec![ids[1].clone()]);
    }

    #[test]
    fn remove_live_stroke_rejects_a_contour_without_a_live_stroke() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, two_point_contour(80.0));
        let contour_id = first_contour_id(&font, layer_id);
        let before = font.clone();

        let result = font.apply_intents(&FontIntentSet::from(RemoveLiveStroke {
            layer_id,
            contour_ids: vec![contour_id],
        }));

        assert!(matches!(
            result,
            Err(CoreError::StrokeOperationFailed { .. })
        ));
        assert_eq!(font, before);
    }

    #[test]
    fn live_stroke_contour_ids_list_only_skeletons_with_a_style() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, two_point_contour(80.0));
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.add_contour(two_point_contour(40.0));
        layer.add_contour(two_point_contour(20.0));
        let ids: Vec<ContourId> = layer.contours_iter().map(Contour::id).collect();
        layer.set_stroke_lib(&LayerStrokeLib {
            contours: std::collections::BTreeMap::from([
                (
                    ids[0].to_string(),
                    ContourStrokeEntry {
                        role: ContourStrokeRole::Skeleton,
                        style_id: None,
                        outline_style: Some(OutlineStrokeStyle::round(10.0)),
                    },
                ),
                (
                    ids[1].to_string(),
                    ContourStrokeEntry {
                        role: ContourStrokeRole::Skeleton,
                        style_id: Some("icon".to_string()),
                        outline_style: None,
                    },
                ),
                (
                    ids[2].to_string(),
                    ContourStrokeEntry {
                        role: ContourStrokeRole::Outline,
                        style_id: None,
                        outline_style: Some(OutlineStrokeStyle::round(10.0)),
                    },
                ),
            ]),
        });

        assert_eq!(layer.live_stroke_contour_ids(), vec![ids[0].clone()]);
    }

    #[test]
    fn live_strokes_carry_the_stored_style_and_follow_a_restyle() {
        let mut layer = GlyphLayer::with_width(
            LayerId::from_raw("live_strokes"),
            crate::SourceId::from_raw("live_strokes_source"),
            500.0,
        );
        let styled = layer.add_contour(two_point_contour(80.0));
        layer.add_contour(two_point_contour(40.0));
        let first = OutlineStrokeStyle {
            position: -0.5,
            ..OutlineStrokeStyle::round(10.0)
        };
        layer
            .set_live_stroke_contours(std::slice::from_ref(&styled), first)
            .unwrap();

        assert_eq!(
            layer.live_strokes(),
            vec![LiveStroke {
                contour_id: styled.clone(),
                style: first,
            }]
        );

        let second = OutlineStrokeStyle::round(24.0);
        layer
            .set_live_stroke_contours(std::slice::from_ref(&styled), second)
            .unwrap();

        assert_eq!(layer.live_strokes()[0].style, second);
    }

    #[test]
    fn baked_outline_of_an_open_skeleton_is_a_closed_contour_without_a_repeated_end_point() {
        let mut layer = GlyphLayer::with_width(
            LayerId::from_raw("bake_closed"),
            crate::SourceId::from_raw("bake_closed_source"),
            500.0,
        );
        let id = layer.add_contour(two_point_contour(80.0));
        layer
            .set_live_stroke_contours(std::slice::from_ref(&id), OutlineStrokeStyle::round(16.0))
            .unwrap();

        let created = layer
            .bake_stroke_outlines(std::slice::from_ref(&id), DEFAULT_TOLERANCE)
            .unwrap();

        assert_eq!(created.len(), 1);
        let baked = layer.contour(&created[0]).unwrap();
        let first = baked.points().first().unwrap();
        let last = baked.points().last().unwrap();
        assert!(
            baked.is_closed(),
            "a baked outline is a fill, so it must be closed"
        );
        assert!(
            (first.x(), first.y()) != (last.x(), last.y()),
            "a closed contour does not repeat its start point"
        );
    }

    #[test]
    fn bake_removes_skeleton_and_stroke_lib_entry() {
        let mut font = sample_font();
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(80.0, 0.0, PointType::OnCurve, false);
        let layer_id = stroke_test_layer(&mut font, contour);
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();

        apply_undo_redo(
            &mut font,
            FontIntentSet::from(SetLiveStroke {
                layer_id,
                contour_ids: vec![contour_id.clone()],
                style: OutlineStrokeStyle::round(16.0),
            }),
        );

        assert!(font.layer(layer_id).unwrap().stroke_lib().is_some());

        apply_undo_redo(
            &mut font,
            FontIntentSet::from(BakeStrokeOutlines {
                layer_id,
                contour_ids: vec![contour_id.clone()],
                tolerance: DEFAULT_TOLERANCE,
            }),
        );

        let layer = font.layer(layer_id).unwrap();
        assert!(layer.contour(&contour_id).is_none());
        assert!(layer.stroke_lib().is_none());
        let created: Vec<_> = layer.contours_iter().map(Contour::id).collect();
        assert_eq!(created.len(), 1);
        crate::stroke::layer_edit::contours_closed_oracle(layer, &created, 1e-6).unwrap();
    }

    /// A butt-capped width-20 style at `position`.
    fn positioned(position: f64) -> OutlineStrokeStyle {
        OutlineStrokeStyle {
            cap: StrokeCap::Butt,
            position,
            ..OutlineStrokeStyle::round(20.0)
        }
    }

    /// The vertical extent of every point of `contours`.
    fn vertical_extent(contours: impl IntoIterator<Item = Contour>) -> (f64, f64) {
        let ys: Vec<f64> = contours
            .into_iter()
            .flat_map(|contour| {
                contour
                    .points()
                    .iter()
                    .map(crate::ir::point::Point::y)
                    .collect::<Vec<_>>()
            })
            .collect();

        (
            ys.iter().copied().fold(f64::INFINITY, f64::min),
            ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        )
    }

    fn baked_extent(position: f64, skeleton: Contour) -> (f64, f64) {
        let mut font = sample_font();
        let layer_id = layer_with_live_strokes(&mut font, vec![skeleton], positioned(position));
        let mut layer = font.layer(layer_id).unwrap().clone();
        let ids = layer.live_stroke_contour_ids();
        let created = layer.bake_stroke_outlines(&ids, DEFAULT_TOLERANCE).unwrap();

        vertical_extent(created.iter().map(|id| layer.contour(id).unwrap().clone()))
    }

    fn previewed_extent(position: f64, skeleton: Contour) -> (f64, f64) {
        let mut font = sample_font();
        let layer_id = layer_with_live_strokes(&mut font, vec![skeleton], positioned(position));
        let previews = font
            .layer(layer_id)
            .unwrap()
            .stroke_outlines_for_preview(DEFAULT_TOLERANCE)
            .unwrap();

        vertical_extent(previews.into_iter().flat_map(|preview| preview.outlines))
    }

    fn reversed_two_point_contour(start_x: f64) -> Contour {
        let mut contour = Contour::new();
        contour.add_point(start_x, 0.0, PointType::OnCurve, false);
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour
    }

    #[test]
    fn a_stroke_lies_on_the_side_its_position_names_in_preview_and_bake() {
        // Left to right: left of travel is up.
        for (position, expected) in [
            (-1.0, (0.0, 20.0)),
            (0.0, (-10.0, 10.0)),
            (1.0, (-20.0, 0.0)),
        ] {
            for (what, (low, high)) in [
                (
                    "preview",
                    previewed_extent(position, two_point_contour(100.0)),
                ),
                ("bake", baked_extent(position, two_point_contour(100.0))),
            ] {
                assert!(
                    (low - expected.0).abs() < 0.01 && (high - expected.1).abs() < 0.01,
                    "{what} at position {position}: y in [{low}, {high}], expected {expected:?}"
                );
            }
        }
    }

    #[test]
    fn reversing_the_skeleton_swaps_the_side_of_a_position() {
        let (low, high) = previewed_extent(-1.0, reversed_two_point_contour(100.0));

        assert!(
            (low + 20.0).abs() < 0.01 && high.abs() < 0.01,
            "y in [{low}, {high}]"
        );
    }

    #[test]
    fn expanding_with_a_style_places_the_outline_by_its_position() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, two_point_contour(100.0));
        let mut layer = font.layer(layer_id).unwrap().clone();
        let ids: Vec<ContourId> = layer.contours_iter().map(Contour::id).collect();

        let created = layer
            .outline_stroke_contours(&ids, positioned(1.0), DEFAULT_TOLERANCE)
            .unwrap();

        let (low, high) =
            vertical_extent(created.iter().map(|id| layer.contour(id).unwrap().clone()));
        assert!(
            (low + 20.0).abs() < 0.01 && high.abs() < 0.01,
            "y in [{low}, {high}]"
        );
    }

    #[test]
    fn a_position_outside_minus_one_to_one_is_refused_and_changes_nothing() {
        for position in [1.5, -1.01, f64::NAN, f64::INFINITY] {
            let mut font = sample_font();
            let layer_id = stroke_test_layer(&mut font, two_point_contour(100.0));
            let ids: Vec<ContourId> = font
                .layer(layer_id)
                .unwrap()
                .contours_iter()
                .map(Contour::id)
                .collect();
            let before = font.clone();

            let set = font.apply_intents(&FontIntentSet::from(SetLiveStroke {
                layer_id,
                contour_ids: ids.clone(),
                style: positioned(position),
            }));
            assert!(set.is_err(), "set live stroke accepted position {position}");
            assert_eq!(font, before);

            let mut layer = font.layer(layer_id).unwrap().clone();
            let outlined =
                layer.outline_stroke_contours(&ids, positioned(position), DEFAULT_TOLERANCE);
            assert!(outlined.is_err(), "expand accepted position {position}");
        }
    }

    #[test]
    fn the_refusal_of_a_position_says_what_the_range_is() {
        let mut layer = GlyphLayer::with_width(
            LayerId::from_raw("range_layer"),
            crate::SourceId::from_raw("range_source"),
            500.0,
        );

        let error = layer
            .set_live_stroke_contours(&[], positioned(2.0))
            .unwrap_err();

        assert!(error.to_string().contains("between -1 and 1"), "{error}");
    }

    #[test]
    fn a_stored_style_without_a_position_reads_as_no_style() {
        let mut lib = LayerStrokeLib {
            contours: std::collections::BTreeMap::from([(
                "c1".to_string(),
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: None,
                    outline_style: Some(OutlineStrokeStyle::round(20.0)),
                },
            )]),
        }
        .to_lib();
        let crate::LibValue::Dict(top) = &mut lib else {
            panic!("stroke lib is a dict");
        };
        let crate::LibValue::Dict(contours) = top.get_mut("contours").unwrap() else {
            panic!("contours is a dict");
        };
        let crate::LibValue::Dict(entry) = contours.get_mut("c1").unwrap() else {
            panic!("entry is a dict");
        };
        let crate::LibValue::Dict(style) = entry.get_mut("outlineStyle").unwrap() else {
            panic!("style is a dict");
        };
        assert!(style.remove("position").is_some(), "position is stored");

        let restored = LayerStrokeLib::from_lib(&lib).unwrap();

        assert_eq!(restored.contours["c1"].outline_style, None);
    }
}
