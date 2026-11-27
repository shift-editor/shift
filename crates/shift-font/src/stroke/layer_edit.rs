//! Destructive stroke and offset helpers on [`GlyphLayer`](GlyphLayer).

use kurbo::{BezPath, Rect};

use crate::contour::Contours;
use crate::{ContourId, CoreError, CoreResult, GlyphLayer, Require};

use super::exact_offset::{self, path_bbox, path_is_closed};
use super::position;
use super::style::{OutlineStrokeStyle, StrokeJoin};

/// Converts `contour` to a kurbo path suitable for stroke or offset solvers.
pub fn contour_skeleton_path(contour: &crate::Contour) -> BezPath {
    BezPath::from(contour)
}

/// Installs fill contours parsed from `path`, returning their ids.
pub(crate) fn install_path_contours(
    layer: &mut GlyphLayer,
    path: &BezPath,
) -> CoreResult<Vec<ContourId>> {
    if path.elements().is_empty() {
        return Err(CoreError::StrokeOperationFailed {
            message: "solver produced an empty path".to_string(),
        });
    }

    let Contours(contours) = Contours::from(path);
    if contours.is_empty() {
        return Err(CoreError::StrokeOperationFailed {
            message: "solver produced no contours".to_string(),
        });
    }

    Ok(contours
        .into_iter()
        .map(|contour| layer.add_contour(contour))
        .collect())
}

pub(crate) fn require_stroke_geometry(contour: &crate::Contour) -> CoreResult<()> {
    if contour.points().len() < 2 {
        return Err(CoreError::StrokeOperationFailed {
            message: "contour needs at least two points".to_string(),
        });
    }

    Ok(())
}

impl GlyphLayer {
    /// Replaces each listed contour with the constant-width stroke outline of its geometry.
    ///
    /// Open skeletons become closed fill contours via caps; closed skeletons stay closed.
    /// Stroke lib entries for removed contours are dropped via [`GlyphLayer::remove_contour`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ContourNotFound`] when a contour id is missing, and
    /// [`CoreError::StrokeOperationFailed`] when geometry is invalid or the solver returns nothing.
    pub fn outline_stroke_contours(
        &mut self,
        contour_ids: &[ContourId],
        style: OutlineStrokeStyle,
        tolerance: f64,
    ) -> CoreResult<Vec<ContourId>> {
        style.require_valid()?;

        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "tolerance must be a finite value greater than zero".to_string(),
            });
        }

        let exact = style.to_exact();
        let mut created = Vec::new();

        for contour_id in contour_ids {
            let contour = self.contour(contour_id).require(contour_id)?.clone();
            require_stroke_geometry(&contour)?;

            let skeleton = contour_skeleton_path(&contour);
            let outline = exact_offset::outline(&skeleton, &exact, tolerance);

            self.remove_contour_checked(contour_id)?;
            created.extend(install_path_contours(self, &outline)?);
        }

        Ok(created)
    }

    /// Offsets an open or closed contour by a constant normal distance.
    ///
    /// The side follows the path direction, as stroke position does: a negative `distance`
    /// offsets to the left of the direction of travel, a positive one to the right. A
    /// counter-clockwise closed contour therefore grows for a positive distance and shrinks for a
    /// negative one; a clockwise contour does the opposite. An open contour stays open. Join
    /// style and miter limit apply where the offset opens a gap at a corner. A live stroke on the
    /// contour moves with it, keeping its style.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ContourNotFound`] when the contour is missing,
    /// [`CoreError::StrokeOperationFailed`] when parameters are invalid or the contour has fewer
    /// than two points, and the same error when the offset solver returns nothing.
    pub fn offset_contour(
        &mut self,
        contour_id: &ContourId,
        distance: f64,
        join: StrokeJoin,
        miter_limit: f64,
        tolerance: f64,
    ) -> CoreResult<Vec<ContourId>> {
        if !distance.is_finite() || distance == 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "offset distance must be a non-zero finite value".to_string(),
            });
        }

        if !miter_limit.is_finite() || miter_limit <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "miter limit must be a finite value greater than zero".to_string(),
            });
        }

        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "tolerance must be a finite value greater than zero".to_string(),
            });
        }

        let contour = self.contour(contour_id).require(contour_id)?.clone();
        require_stroke_geometry(&contour)?;

        let skeleton = contour_skeleton_path(&contour);
        // `offset_path` measures positive to the left; the user-facing sign is the position's.
        let offset = position::offset_path(
            &skeleton,
            -distance,
            join.to_kurbo(),
            miter_limit,
            tolerance,
        );

        // The moved contour is a new contour with a new id, so a live stroke on the original
        // would be pruned with it; carry the entry across instead.
        let stroke_entry = self.stroke_entry(contour_id);
        self.remove_contour_checked(contour_id)?;
        let created = install_path_contours(self, &offset)?;
        if let Some(entry) = stroke_entry {
            self.assign_stroke_entry(&created, &entry);
        }

        Ok(created)
    }
}

/// Bounding box oracle helper for tests: rejects empty paths.
///
/// # Errors
///
/// Returns [`CoreError::StrokeOperationFailed`] when the path bounds are degenerate.
pub fn contour_bounds_oracle(path: &BezPath) -> CoreResult<Rect> {
    let bbox = path_bbox(path);
    if bbox.width() > 0.0 && bbox.height() > 0.0 {
        return Ok(bbox);
    }

    Err(CoreError::StrokeOperationFailed {
        message: "path has degenerate bounds".to_string(),
    })
}

/// Whether every contour in `layer` with ids in `created` is closed (within `epsilon`).
///
/// # Errors
///
/// Returns [`CoreError::StrokeOperationFailed`] when a contour is missing or not closed.
pub fn contours_closed_oracle(
    layer: &GlyphLayer,
    contour_ids: &[ContourId],
    epsilon: f64,
) -> CoreResult<()> {
    for contour_id in contour_ids {
        let contour = layer.contour(contour_id).require(contour_id)?;
        let path = contour_skeleton_path(contour);
        if !path_is_closed(&path, epsilon) {
            return Err(CoreError::StrokeOperationFailed {
                message: format!("contour {contour_id} is not closed"),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use kurbo::BezPath;

    use crate::stroke::{
        ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, StrokeCap, StrokeJoin,
    };
    use crate::test_support::{apply_undo_redo, sample_font};
    use crate::{
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, OffsetContour,
        OutlineStroke, PointType,
    };

    use super::*;
    use crate::stroke::DEFAULT_TOLERANCE;
    use crate::stroke::exact_offset::outline;

    struct Fixture {
        name: String,
        skeleton: BezPath,
        stroke_width: f64,
        closed: bool,
    }

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stroke")
    }

    fn json_string_field(body: &str, key: &str) -> Option<String> {
        let needle = format!("\"{key}\"");
        let key_start = body.find(&needle)?;
        let after_key = &body[key_start + needle.len()..];
        let colon = after_key.find(':')?;
        let rest = after_key[colon + 1..].trim_start();
        if !rest.starts_with('"') {
            return None;
        }
        let inner = &rest[1..];
        let end = inner.find('"')?;
        Some(inner[..end].to_string())
    }

    fn json_number_field(body: &str, key: &str) -> Option<f64> {
        let needle = format!("\"{key}\"");
        let key_start = body.find(&needle)?;
        let after_key = &body[key_start + needle.len()..];
        let colon = after_key.find(':')?;
        let rest = after_key[colon + 1..].trim_start();
        let end = rest
            .find(|character: char| [',', '}', '\n'].contains(&character))
            .unwrap_or(rest.len());
        rest[..end].trim().parse().ok()
    }

    fn load_json_fixture(path: &Path) -> Fixture {
        let body = fs::read_to_string(path).unwrap_or_else(|error| {
            panic!("read {}: {error}", path.display());
        });
        let name = json_string_field(&body, "name").unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("unknown")
                .to_string()
        });
        let path_d = json_string_field(&body, "path_d")
            .unwrap_or_else(|| panic!("missing path_d in {}", path.display()));
        let stroke_width = json_number_field(&body, "stroke_width").unwrap_or(20.0);
        let closed = json_string_field(&body, "closed").is_some_and(|text| text == "true");
        let skeleton = BezPath::from_svg(&path_d)
            .unwrap_or_else(|error| panic!("invalid path_d in {name}: {error}"));
        Fixture {
            name,
            skeleton,
            stroke_width,
            closed,
        }
    }

    fn load_fixtures() -> Vec<Fixture> {
        let dir = fixtures_dir();
        let mut fixtures = Vec::new();
        for entry in fs::read_dir(&dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
                fixtures.push(load_json_fixture(&path));
            }
        }
        fixtures.sort_by(|left, right| left.name.cmp(&right.name));
        fixtures
    }

    fn contour_from_path(path: &BezPath, closed: bool) -> Contour {
        let Contours(mut contours) = Contours::from(path);
        assert_eq!(contours.len(), 1, "fixture should be one subpath");
        let contour = contours.remove(0);
        let mut contour = contour;
        if closed {
            contour.close();
        }
        contour
    }

    fn stroke_test_layer(font: &mut crate::Font, contour: Contour) -> LayerId {
        let glyph_id = GlyphId::from_raw("stroke_glyph");
        let source_id = font.default_source_id().unwrap();
        let layer_id = LayerId::from_raw("stroke_layer");
        if font.glyph(glyph_id).is_none() {
            font.apply_intents(&FontIntentSet::from(CreateGlyph {
                glyph_id: Some(glyph_id),
                name: "stroke_glyph".to_string(),
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
    fn outline_stroke_intent_matches_fixture_oracles() {
        let fixtures = load_fixtures();
        for fixture in &fixtures {
            let mut font = sample_font();
            let contour = contour_from_path(&fixture.skeleton, fixture.closed);
            let style = OutlineStrokeStyle::round(fixture.stroke_width);
            let expected = outline(&fixture.skeleton, &style.to_exact(), DEFAULT_TOLERANCE);
            let expected_bbox = contour_bounds_oracle(&expected).unwrap();

            let layer_id = stroke_test_layer(&mut font, contour);
            let contour_id = font
                .layer(layer_id)
                .unwrap()
                .contours_iter()
                .next()
                .unwrap()
                .id()
                .clone();

            let set = FontIntentSet::from(OutlineStroke {
                layer_id,
                contour_ids: vec![contour_id.clone()],
                style,
                tolerance: DEFAULT_TOLERANCE,
            });
            apply_undo_redo(&mut font, set);

            let layer = font.layer(layer_id).unwrap();
            assert!(
                layer.contour(&contour_id).is_none(),
                "{} should replace the skeleton contour",
                fixture.name
            );
            let created: Vec<_> = layer.contours_iter().map(Contour::id).collect();
            assert!(!created.is_empty(), "{}", fixture.name);
            contours_closed_oracle(layer, &created, 1e-6).unwrap();

            let mut max_width: f64 = 0.0;
            let mut max_height: f64 = 0.0;
            for id in &created {
                let path = contour_skeleton_path(layer.contour(id).unwrap());
                let bbox = path_bbox(&path);
                max_width = max_width.max(bbox.width());
                max_height = max_height.max(bbox.height());
            }

            assert!(
                (max_width - expected_bbox.width()).abs() < 2.0,
                "{} width oracle",
                fixture.name
            );
            assert!(
                (max_height - expected_bbox.height()).abs() < 2.0,
                "{} height oracle",
                fixture.name
            );
        }
    }

    #[test]
    fn outline_stroke_prunes_skeleton_stroke_lib_entry() {
        let mut font = sample_font();
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        let layer_id = stroke_test_layer(&mut font, contour);
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        let mut layer = font.layer(layer_id).unwrap().clone();
        layer.set_stroke_lib(&LayerStrokeLib {
            contours: std::collections::BTreeMap::from([(
                contour_id.to_string(),
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: Some("icon".to_string()),
                    outline_style: None,
                },
            )]),
        });
        font.replace_glyph_layers(vec![layer]).unwrap();
        assert!(font.layer(layer_id).unwrap().stroke_lib().is_some());

        font.apply_intents(&FontIntentSet::from(OutlineStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle::round(20.0),
            tolerance: DEFAULT_TOLERANCE,
        }))
        .unwrap();

        assert!(
            font.layer(layer_id).unwrap().stroke_lib().is_none(),
            "orphan skeleton lib entry should be pruned"
        );
    }

    #[test]
    fn offset_contour_grows_closed_square() {
        let mut font = sample_font();
        let mut contour = Contour::new();
        for (x, y) in [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)] {
            contour.add_point(x, y, PointType::OnCurve, false);
        }
        contour.close();
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
            FontIntentSet::from(OffsetContour {
                layer_id,
                contour_id,
                distance: 10.0,
                join: StrokeJoin::Round,
                miter_limit: OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
                tolerance: DEFAULT_TOLERANCE,
            }),
        );

        let layer = font.layer(layer_id).unwrap();
        let created: Vec<_> = layer.contours_iter().map(Contour::id).collect();
        contours_closed_oracle(layer, &created, 1e-6).unwrap();
        let path = contour_skeleton_path(layer.contour(&created[0]).unwrap());
        let bbox = path_bbox(&path);
        assert!(bbox.width() > 100.0);
        assert!(bbox.height() > 100.0);
    }

    #[test]
    fn outline_stroke_rejects_invalid_width() {
        let mut font = sample_font();
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(50.0, 0.0, PointType::OnCurve, false);
        let layer_id = stroke_test_layer(&mut font, contour);
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        let before = font.clone();
        let result = font.apply_intents(&FontIntentSet::from(OutlineStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle {
                width: 0.0,
                cap: StrokeCap::Round,
                join: StrokeJoin::Round,
                miter_limit: 4.0,
                position: 0.0,
            },
            tolerance: DEFAULT_TOLERANCE,
        }));
        assert!(result.is_err());
        assert_eq!(font, before);
    }

    /// Offsets the only contour of a fresh layer, returning the layer.
    fn offset_only_contour(contour: Contour, distance: f64) -> CoreResult<GlyphLayer> {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, contour);
        let mut layer = font.layer(layer_id).unwrap().clone();
        let contour_id = layer.contours_iter().next().unwrap().id();

        layer.offset_contour(
            &contour_id,
            distance,
            StrokeJoin::Round,
            OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
            DEFAULT_TOLERANCE,
        )?;

        Ok(layer)
    }

    fn square(corners: [(f64, f64); 4]) -> Contour {
        let mut contour = Contour::new();
        for (x, y) in corners {
            contour.add_point(x, y, PointType::OnCurve, false);
        }
        contour.close();
        contour
    }

    fn only_bounds(layer: &GlyphLayer) -> Rect {
        assert_eq!(layer.contours_iter().count(), 1, "one contour out");
        path_bbox(&contour_skeleton_path(
            layer.contours_iter().next().unwrap(),
        ))
    }

    #[test]
    fn an_open_contour_offsets_to_the_left_for_a_negative_distance_and_stays_open() {
        let line = || {
            let mut contour = Contour::new();
            contour.add_point(0.0, 0.0, PointType::OnCurve, false);
            contour.add_point(100.0, 0.0, PointType::OnCurve, false);
            contour
        };

        let left = offset_only_contour(line(), -15.0).unwrap();
        let right = offset_only_contour(line(), 15.0).unwrap();

        let (left_bounds, right_bounds) = (only_bounds(&left), only_bounds(&right));
        assert!((left_bounds.y0 - 15.0).abs() < 1e-6 && (left_bounds.y1 - 15.0).abs() < 1e-6);
        assert!((right_bounds.y0 + 15.0).abs() < 1e-6 && (right_bounds.y1 + 15.0).abs() < 1e-6);
        assert!((left_bounds.x0).abs() < 1e-6 && (left_bounds.x1 - 100.0).abs() < 1e-6);
        assert!(
            !left.contours_iter().next().unwrap().is_closed(),
            "stays open"
        );
    }

    /// Whether the only contour of `layer` fills the point `(x, y)`.
    fn fills(layer: &GlyphLayer, x: f64, y: f64) -> bool {
        let path = contour_skeleton_path(layer.contours_iter().next().unwrap());

        kurbo::Shape::winding(&path, kurbo::Point::new(x, y)) != 0
    }

    #[test]
    fn a_counter_clockwise_contour_grows_for_a_positive_distance() {
        let ccw = || square([(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]);

        let grown = offset_only_contour(ccw(), 10.0).unwrap();
        let shrunk = offset_only_contour(ccw(), -10.0).unwrap();

        assert!(fills(&grown, 105.0, 50.0) && fills(&grown, 50.0, 50.0));
        assert!(!fills(&shrunk, 5.0, 50.0) && fills(&shrunk, 50.0, 50.0));
    }

    #[test]
    fn a_clockwise_contour_offsets_the_other_way() {
        let cw = || square([(0.0, 0.0), (0.0, 100.0), (100.0, 100.0), (100.0, 0.0)]);

        let positive = offset_only_contour(cw(), 10.0).unwrap();
        let negative = offset_only_contour(cw(), -10.0).unwrap();

        assert!(!fills(&positive, 5.0, 50.0) && fills(&positive, 50.0, 50.0));
        assert!(fills(&negative, 105.0, 50.0) && fills(&negative, 50.0, 50.0));
    }

    #[test]
    fn a_closed_offset_stays_closed() {
        let layer = offset_only_contour(
            square([(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]),
            10.0,
        )
        .unwrap();

        assert!(layer.contours_iter().next().unwrap().is_closed());
    }

    /// A layer holding `contour` as a live stroke in `style`, and the contour's id.
    fn layer_with_live_stroke(
        contour: Contour,
        style: OutlineStrokeStyle,
    ) -> (GlyphLayer, ContourId) {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, contour);
        let mut layer = font.layer(layer_id).unwrap().clone();
        let contour_id = layer.contours_iter().next().unwrap().id();
        layer
            .set_live_stroke_contours(std::slice::from_ref(&contour_id), style)
            .unwrap();

        (layer, contour_id)
    }

    fn horizontal_line() -> Contour {
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        contour
    }

    #[test]
    fn offsetting_a_contour_keeps_its_live_stroke_on_the_moved_contour() {
        let style = OutlineStrokeStyle {
            width: 24.0,
            cap: StrokeCap::Butt,
            join: StrokeJoin::Miter,
            miter_limit: 7.0,
            position: -0.5,
        };
        let (mut layer, old_id) = layer_with_live_stroke(horizontal_line(), style);

        let created = layer
            .offset_contour(
                &old_id,
                15.0,
                StrokeJoin::Round,
                OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
                DEFAULT_TOLERANCE,
            )
            .unwrap();

        assert!(layer.contour(&old_id).is_none(), "the old contour is gone");
        let strokes = layer.live_strokes();
        assert_eq!(strokes.len(), 1, "one stroke, not one left behind");
        assert_eq!(strokes[0].contour_id, created[0]);
        assert_eq!(strokes[0].style, style, "the style is the one it had");
        assert!(layer.orphan_stroke_lib_contour_ids().is_empty());
    }

    #[test]
    fn offsetting_a_plain_contour_leaves_no_stroke_and_another_stroke_alone() {
        let (mut layer, stroked) =
            layer_with_live_stroke(horizontal_line(), OutlineStrokeStyle::round(10.0));
        let mut plain = Contour::new();
        plain.add_point(0.0, 200.0, PointType::OnCurve, false);
        plain.add_point(100.0, 200.0, PointType::OnCurve, false);
        let plain_id = layer.add_contour(plain);

        layer
            .offset_contour(
                &plain_id,
                10.0,
                StrokeJoin::Round,
                OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
                DEFAULT_TOLERANCE,
            )
            .unwrap();

        let strokes = layer.live_strokes();
        assert_eq!(strokes.len(), 1);
        assert_eq!(strokes[0].contour_id, stroked, "the other stroke stays put");
    }

    #[test]
    fn a_refused_offset_leaves_the_live_stroke_where_it_was() {
        let (mut layer, id) =
            layer_with_live_stroke(horizontal_line(), OutlineStrokeStyle::round(10.0));
        let before = layer.clone();

        let result = layer.offset_contour(
            &id,
            0.0,
            StrokeJoin::Round,
            OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
            DEFAULT_TOLERANCE,
        );

        assert!(result.is_err());
        assert_eq!(layer, before);
    }

    #[test]
    fn offsetting_a_dynamic_contour_through_the_intent_undoes_and_redoes_with_its_stroke() {
        let mut font = sample_font();
        let layer_id = stroke_test_layer(&mut font, horizontal_line());
        let contour_id = font
            .layer(layer_id)
            .unwrap()
            .contours_iter()
            .next()
            .unwrap()
            .id();
        font.apply_intents(&FontIntentSet::from(crate::SetLiveStroke {
            layer_id,
            contour_ids: vec![contour_id.clone()],
            style: OutlineStrokeStyle::round(20.0),
            preset_id: None,
        }))
        .unwrap();

        apply_undo_redo(
            &mut font,
            FontIntentSet::from(OffsetContour {
                layer_id,
                contour_id,
                distance: 10.0,
                join: StrokeJoin::Round,
                miter_limit: OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
                tolerance: DEFAULT_TOLERANCE,
            }),
        );

        let strokes = font.layer(layer_id).unwrap().live_strokes();
        assert_eq!(strokes.len(), 1);
        assert_eq!(strokes[0].style, OutlineStrokeStyle::round(20.0));
    }

    #[test]
    fn a_zero_offset_distance_is_refused() {
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);

        let error = offset_only_contour(contour, 0.0).unwrap_err();

        assert!(error.to_string().contains("non-zero"), "{error}");
    }
}
