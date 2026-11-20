//! Non-destructive constant-width strokes (stream A2): lib metadata + read-time outlines.

use kurbo::BezPath;

use crate::contour::Contours;
use crate::{Contour, ContourId, CoreError, CoreResult, GlyphLayer, Require};

use super::exact_offset::{self, path_bbox};
use super::layer_edit::{contour_skeleton_path, install_path_contours, require_positive_width};
use super::layer_lib::{ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib};
use super::style::OutlineStrokeStyle;

/// One skeleton contour and the fill outlines computed from it at read time.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokeOutlinePreview {
    pub skeleton_contour_id: ContourId,
    pub outlines: Vec<Contour>,
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
        require_positive_width(style.width)?;

        if !style.miter_limit.is_finite() || style.miter_limit <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "miter limit must be a finite value greater than zero".to_string(),
            });
        }

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

    /// Computes stroke fill outlines for every live skeleton on this layer.
    ///
    /// Results are ephemeral: they are not stored on the layer until
    /// [`Self::bake_stroke_outlines`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokeOperationFailed`] when tolerance or a stored style is invalid,
    /// or when the solver returns nothing.
    pub fn stroke_outlines_for_preview(
        &self,
        tolerance: f64,
    ) -> CoreResult<Vec<StrokeOutlinePreview>> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(CoreError::StrokeOperationFailed {
                message: "tolerance must be a finite value greater than zero".to_string(),
            });
        }

        let Some(stroke_lib) = self.stroke_lib() else {
            return Ok(Vec::new());
        };

        let mut previews = Vec::new();
        for (contour_id, entry) in &stroke_lib.contours {
            if entry.role != ContourStrokeRole::Skeleton {
                continue;
            }
            let Some(style) = entry.outline_style else {
                continue;
            };
            let contour_id = ContourId::from_raw(contour_id);
            let contour = self.contour(&contour_id).require(&contour_id)?;
            super::layer_edit::require_stroke_geometry(contour)?;
            let skeleton = contour_skeleton_path(contour);
            let outline = exact_offset::outline(&skeleton, &style.to_exact(), tolerance);
            let outlines = contours_from_outline_path(&outline)?;
            previews.push(StrokeOutlinePreview {
                skeleton_contour_id: contour_id,
                outlines,
            });
        }

        Ok(previews)
    }

    /// Replaces live skeleton contours with baked fill outlines and drops their stroke lib entries.
    ///
    /// Styles are read from [`com.shift.stroke`](super::layer_lib::STROKE_LIB_KEY).
    ///
    /// # Errors
    ///
    /// Same errors as [`Self::outline_stroke_contours`](super::layer_edit::GlyphLayer::outline_stroke_contours),
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

fn contours_from_outline_path(path: &BezPath) -> CoreResult<Vec<Contour>> {
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

    Ok(contours)
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
        Contour, CreateGlyph, CreateGlyphLayer, FontIntentSet, GlyphId, LayerId, MovePoints,
        PointType, SetLiveStroke,
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
        let contour_id = layer.contours_iter().next().unwrap().id().clone();

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
            .id()
            .clone();

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

    #[test]
    fn live_stroke_style_round_trips_through_layer_lib() {
        let style = OutlineStrokeStyle {
            width: 24.0,
            cap: StrokeCap::Square,
            join: StrokeJoin::Miter,
            miter_limit: 8.0,
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
            .id()
            .clone();

        apply_undo_redo(
            &mut font,
            FontIntentSet::from(SetLiveStroke {
                layer_id,
                contour_ids: vec![contour_id.clone()],
                style: OutlineStrokeStyle::round(16.0),
            }),
        );

        assert!(font.layer(layer_id).unwrap().stroke_lib().is_some());

        use crate::BakeStrokeOutlines;
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
        let created: Vec<_> = layer.contours_iter().map(|c| c.id().clone()).collect();
        assert_eq!(created.len(), 1);
        crate::stroke::layer_edit::contours_closed_oracle(layer, &created, 1e-6).unwrap();
    }
}
