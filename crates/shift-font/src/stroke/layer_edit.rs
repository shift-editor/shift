//! Destructive stroke and offset helpers on [`GlyphLayer`](crate::GlyphLayer).

use kurbo::{BezPath, Diagonal2, Rect, expand_path};

use crate::contour::Contours;
use crate::{ContourId, CoreError, CoreResult, GlyphLayer, Require};

use super::exact_offset::{self, path_bbox, path_is_closed};
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

pub(crate) fn require_positive_width(width: f64) -> CoreResult<()> {
    if width > 0.0 && width.is_finite() {
        return Ok(());
    }

    Err(CoreError::StrokeOperationFailed {
        message: "stroke width must be a finite value greater than zero".to_string(),
    })
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
        require_positive_width(style.width)?;

        if !style.miter_limit.is_finite() || style.miter_limit <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "miter limit must be a finite value greater than zero".to_string(),
            });
        }

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

    /// Grows or shrinks a **closed** contour by a constant normal distance.
    ///
    /// Positive `distance` expands outward; negative shrinks. Join style and miter limit follow
    /// the same semantics as outline stroke.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ContourNotFound`] when the contour is missing,
    /// [`CoreError::StrokeOperationFailed`] when the contour is open or parameters are invalid,
    /// and the same error when the offset solver returns nothing.
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
        if !contour.is_closed() {
            return Err(CoreError::StrokeOperationFailed {
                message: "offset path requires a closed contour".to_string(),
            });
        }

        require_stroke_geometry(&contour)?;

        let skeleton = contour_skeleton_path(&contour);
        let expanded = expand_path(
            skeleton,
            Diagonal2::new(distance, distance),
            join.to_kurbo(),
            miter_limit,
            tolerance,
        );

        self.remove_contour_checked(contour_id)?;
        install_path_contours(self, &expanded)
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
            let created: Vec<_> = layer.contours_iter().map(|c| c.id().clone()).collect();
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
            .id()
            .clone();
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
            .id()
            .clone();

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
        let created: Vec<_> = layer.contours_iter().map(|c| c.id().clone()).collect();
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
            .id()
            .clone();
        let before = font.clone();
        let result = font.apply_intents(&FontIntentSet::from(OutlineStroke {
            layer_id,
            contour_ids: vec![contour_id],
            style: OutlineStrokeStyle {
                width: 0.0,
                cap: StrokeCap::Round,
                join: StrokeJoin::Round,
                miter_limit: 4.0,
            },
            tolerance: DEFAULT_TOLERANCE,
        }));
        assert!(result.is_err());
        assert_eq!(font, before);
    }
}
