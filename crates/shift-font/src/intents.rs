//! Renderer-facing intent vocabulary.
//!
//! Intents are what a caller ASKS for; [`FontChange`] records are what the
//! workspace persists. The vocabularies are deliberately distinct: intents
//! carry caller-minted ids and insertion anchors, records carry
//! post-mutation snapshots for the store. CS1 covers the pen scope; later
//! milestones add variants alongside the tools that emit them.

use crate::changes::{FontChange, FontChangeSet, PointPosition};
use crate::error::{CoreError, CoreResult};
use crate::ir::{
    BooleanOp, Contour, ContourId, Font, GlyphId, GlyphLayer, GlyphName, LayerId, PointId,
    PointType,
};
use crate::layer_edit::BulkNodePositionUpdates;

/// A point to create, with its caller-minted id.
#[derive(Clone, Debug)]
pub struct PointSeed {
    pub id: PointId,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

#[derive(Clone, Debug)]
pub enum FontIntent {
    AddPoints {
        layer_id: LayerId,
        /// Target contour; when `None`, derived from `before` (Rust owns
        /// identity resolution — the renderer never bookkeeps pending
        /// point→contour maps).
        contour_id: Option<ContourId>,
        /// Insert before this point; append when `None`.
        before: Option<PointId>,
        points: Vec<PointSeed>,
    },
    AddContour {
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    },
    SetContourClosed {
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    },
    MovePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
        /// Interleaved absolute coordinates: x0, y0, x1, y1, …
        coords: Vec<f64>,
    },
    SetPointSmooth {
        layer_id: LayerId,
        point_id: PointId,
        smooth: bool,
    },
    RemovePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
    },
    ReverseContour {
        layer_id: LayerId,
        contour_id: ContourId,
    },
    /// Affine move: O(selection-ids) wire instead of O(N) coords.
    TranslatePoints {
        layer_id: LayerId,
        point_ids: Vec<PointId>,
        dx: f64,
        dy: f64,
    },
    SetXAdvance {
        layer_id: LayerId,
        width: f64,
    },
    /// Rust-only computation: the echo is the same replace-grade shape as
    /// every other intent — remote changes are not a special case.
    ApplyBooleanOp {
        layer_id: LayerId,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        operation: BooleanOp,
    },
}

impl FontIntent {
    pub fn layer_id(&self) -> &LayerId {
        match self {
            Self::AddPoints { layer_id, .. }
            | Self::AddContour { layer_id, .. }
            | Self::SetContourClosed { layer_id, .. }
            | Self::MovePoints { layer_id, .. }
            | Self::SetPointSmooth { layer_id, .. }
            | Self::RemovePoints { layer_id, .. }
            | Self::ReverseContour { layer_id, .. }
            | Self::TranslatePoints { layer_id, .. }
            | Self::SetXAdvance { layer_id, .. }
            | Self::ApplyBooleanOp { layer_id, .. } => layer_id,
        }
    }

    /// Whether applying this intent changes layer structure (vs values only).
    /// Smooth flags live in structure, so they count.
    fn structural(&self) -> bool {
        !matches!(
            self,
            Self::MovePoints { .. } | Self::TranslatePoints { .. } | Self::SetXAdvance { .. }
        )
    }
}

#[derive(Clone, Debug, Default)]
pub struct FontIntentSet {
    pub intents: Vec<FontIntent>,
}

/// One touched layer after an intent set applied.
pub struct TouchedLayer {
    pub layer: GlyphLayer,
    pub structural: bool,
}

/// Outcome of applying an intent set: canonical records for the store plus
/// replace-grade layer state for echo assembly.
pub struct AppliedIntents {
    pub changes: FontChangeSet,
    /// Unique touched layers in first-touch order; `structural` is OR-ed
    /// across the set.
    pub layers: Vec<TouchedLayer>,
}

impl Font {
    /// Validates and applies an intent set, producing the canonical change
    /// records. All-or-nothing only when the caller applies to a clone and
    /// swaps on success (the workspace's commit pattern).
    pub fn apply_intents(&mut self, set: FontIntentSet) -> CoreResult<AppliedIntents> {
        let mut changes = FontChangeSet::default();
        let mut touched: Vec<(LayerId, bool)> = Vec::new();

        for intent in &set.intents {
            let layer_id = intent.layer_id().clone();
            let structural = intent.structural();

            let change = self.apply_intent(intent)?;
            changes.push(change);

            match touched.iter_mut().find(|(id, _)| *id == layer_id) {
                Some((_, flag)) => *flag |= structural,
                None => touched.push((layer_id, structural)),
            }
        }

        let layers = touched
            .into_iter()
            .map(|(layer_id, structural)| {
                let layer = self
                    .layer(layer_id.clone())
                    .ok_or(CoreError::LayerNotFound(layer_id))?
                    .clone();
                Ok(TouchedLayer { layer, structural })
            })
            .collect::<CoreResult<Vec<_>>>()?;

        Ok(AppliedIntents { changes, layers })
    }

    fn apply_intent(&mut self, intent: &FontIntent) -> CoreResult<FontChange> {
        match intent {
            FontIntent::AddPoints {
                layer_id,
                contour_id,
                before,
                points,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;

                for seed in points {
                    if layer.has_point(seed.id.clone()) {
                        return Err(CoreError::DuplicatePointId(seed.id.clone()));
                    }
                }

                let contour_id = match (contour_id, before) {
                    (Some(contour_id), _) => contour_id.clone(),
                    (None, Some(before_id)) => layer.contour_of_point(before_id.clone())?,
                    (None, None) => {
                        return Err(CoreError::InvalidContourId(
                            "addPoints requires a contour or a before anchor".to_string(),
                        ));
                    }
                };

                let contour = layer
                    .contour_mut(contour_id.clone())
                    .ok_or(CoreError::ContourNotFound(contour_id))?;

                let insert_at = match before {
                    Some(before_id) => Some(
                        contour
                            .points()
                            .iter()
                            .position(|point| point.id() == *before_id)
                            .ok_or(CoreError::PointNotFound(before_id.clone()))?,
                    ),
                    None => None,
                };

                let mut ids = Vec::with_capacity(points.len());
                for (offset, seed) in points.iter().enumerate() {
                    let point = crate::ir::Point::new(
                        seed.id.clone(),
                        seed.x,
                        seed.y,
                        seed.point_type,
                        seed.smooth,
                    );

                    match insert_at {
                        Some(index) => contour.insert_point(index + offset, point),
                        None => contour.push_point(point),
                    }
                    ids.push(seed.id.clone());
                }

                Ok(FontChange::points_added(layer_id.clone(), contour, ids))
            }
            FontIntent::AddContour {
                layer_id,
                contour_id,
                closed,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                if layer.contour(contour_id.clone()).is_some() {
                    return Err(CoreError::DuplicateContourId(contour_id.clone()));
                }

                let mut contour = Contour::with_id(contour_id.clone());
                if *closed {
                    contour.close();
                }

                layer.add_contour(contour.clone());
                Ok(FontChange::contour_added(layer_id.clone(), &contour))
            }
            FontIntent::SetContourClosed {
                layer_id,
                contour_id,
                closed,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                if *closed {
                    layer.close_contour(contour_id.clone())?;
                } else {
                    layer.open_contour(contour_id.clone())?;
                }

                Ok(FontChange::contour_open_closed_changed(
                    layer_id.clone(),
                    contour_id.clone(),
                    *closed,
                ))
            }
            FontIntent::MovePoints {
                layer_id,
                point_ids,
                coords,
            } => {
                if coords.len() != point_ids.len() * 2 {
                    return Err(CoreError::InvalidPointId(format!(
                        "movePoints expects {} coords for {} points, got {}",
                        point_ids.len() * 2,
                        point_ids.len(),
                        coords.len()
                    )));
                }

                let layer = self.layer_mut_or_err(layer_id)?;
                layer.apply_bulk_node_positions(BulkNodePositionUpdates {
                    point_ids: Some(point_ids),
                    point_coords: Some(coords),
                    anchor_ids: None,
                    anchor_coords: None,
                })?;

                let positions = point_ids
                    .iter()
                    .zip(coords.chunks_exact(2))
                    .map(|(point_id, xy)| PointPosition {
                        point_id: point_id.clone(),
                        x: xy[0],
                        y: xy[1],
                    })
                    .collect();

                Ok(FontChange::point_positions_changed(
                    layer_id.clone(),
                    positions,
                ))
            }
            FontIntent::SetPointSmooth {
                layer_id,
                point_id,
                smooth,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.set_point_smooth(point_id.clone(), *smooth)?;

                Ok(FontChange::point_smooth_changed(
                    layer_id.clone(),
                    point_id.clone(),
                    *smooth,
                ))
            }
            FontIntent::RemovePoints {
                layer_id,
                point_ids,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.remove_points(point_ids)?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::ReverseContour {
                layer_id,
                contour_id,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.reverse_contour(contour_id.clone())?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
            FontIntent::TranslatePoints {
                layer_id,
                point_ids,
                dx,
                dy,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.move_points(point_ids, *dx, *dy)?;

                let positions = point_ids
                    .iter()
                    .map(|point_id| {
                        let contour_id = layer.contour_of_point(point_id.clone())?;
                        let point = layer
                            .contour(contour_id)
                            .and_then(|contour| contour.get_point(point_id.clone()))
                            .ok_or(CoreError::PointNotFound(point_id.clone()))?;
                        Ok(PointPosition {
                            point_id: point_id.clone(),
                            x: point.x(),
                            y: point.y(),
                        })
                    })
                    .collect::<CoreResult<Vec<_>>>()?;

                Ok(FontChange::point_positions_changed(
                    layer_id.clone(),
                    positions,
                ))
            }
            FontIntent::SetXAdvance { layer_id, width } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.set_x_advance(*width);

                Ok(FontChange::layer_metrics_changed(layer))
            }
            FontIntent::ApplyBooleanOp {
                layer_id,
                contour_id_a,
                contour_id_b,
                operation,
            } => {
                let layer = self.layer_mut_or_err(layer_id)?;
                layer.apply_boolean_op(contour_id_a.clone(), contour_id_b.clone(), *operation)?;

                Ok(FontChange::layer_geometry_replaced(layer))
            }
        }
    }

    /// Ids of glyphs whose components reference the glyphs owning the
    /// given layers — the composites a renderer must re-render after an
    /// edit. Stable ids (not names): references survive renames. Sorted,
    /// deduplicated, excludes the touched glyphs themselves.
    pub fn dependents_of_layers(&self, layer_ids: &[LayerId]) -> Vec<GlyphId> {
        let touched: Vec<&GlyphName> = self
            .glyphs()
            .filter(|glyph| {
                glyph
                    .layers()
                    .keys()
                    .any(|layer_id| layer_ids.contains(layer_id))
            })
            .map(|glyph| glyph.glyph_name())
            .collect();

        let mut dependents: Vec<GlyphId> = self
            .glyphs()
            .filter(|glyph| !touched.contains(&glyph.glyph_name()))
            .filter(|glyph| {
                glyph.layers().values().any(|layer| {
                    layer
                        .components_iter()
                        .any(|component| touched.contains(&component.base_glyph()))
                })
            })
            .map(|glyph| glyph.id())
            .collect();

        dependents.sort();
        dependents.dedup();
        dependents
    }

    fn layer_mut_or_err(&mut self, layer_id: &LayerId) -> CoreResult<&mut GlyphLayer> {
        self.layer_mut(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id.clone()))
    }
}
