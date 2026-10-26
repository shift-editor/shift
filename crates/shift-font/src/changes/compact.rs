//! A change set as one process sends another to persist.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::{FontChange, FontChangeSet, Replacement};
use crate::error::{CoreError, CoreResult};
use crate::{Font, GlyphId, GlyphInterpolationValues, GlyphLayer, LayerId};

/// A [`FontChangeSet`] for sending: a layer change that only moved values
/// travels as the layer's values before and after, not as the layer twice,
/// and is made whole again against the receiving font
/// ([`CompactChangeSet::expand`]).
///
/// A 50,000-point move encodes to 1.8 MB instead of 7 MB, in a tenth of the
/// time each way.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompactChangeSet {
    changes: Vec<CompactChange>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CompactChange {
    Change(FontChange),
    /// A layer whose values changed and nothing else, as its values before
    /// and after in interpolation order.
    LayerValues {
        glyph_id: GlyphId,
        layer_id: LayerId,
        before: Vec<f64>,
        after: Vec<f64>,
    },
}

impl FontChangeSet {
    /// This change set for sending, each layer change that only moved values
    /// as values. A change goes as values only when applying its after values
    /// to its before layer gives exactly its after layer, so nothing outside
    /// the values (a height, a name, a point's type) can be lost.
    pub fn compact(&self) -> CompactChangeSet {
        let changes = self
            .changes
            .iter()
            .map(|change| match change {
                FontChange::Layer {
                    glyph_id,
                    layer:
                        Replacement {
                            before: Some(before),
                            after: Some(after),
                        },
                    structural: false,
                } => values_only(before, after).map_or_else(
                    || CompactChange::Change(change.clone()),
                    |(before, after_values)| CompactChange::LayerValues {
                        glyph_id: *glyph_id,
                        layer_id: after.id(),
                        before,
                        after: after_values,
                    },
                ),
                _ => CompactChange::Change(change.clone()),
            })
            .collect();
        CompactChangeSet { changes }
    }
}

impl CompactChangeSet {
    /// The layers a receiver must have loaded before
    /// [`CompactChangeSet::expand`]: those sent as values.
    pub fn value_layer_ids(&self) -> impl Iterator<Item = LayerId> + '_ {
        self.changes.iter().filter_map(|change| match change {
            CompactChange::LayerValues { layer_id, .. } => Some(*layer_id),
            CompactChange::Change(_) => None,
        })
    }

    /// The full change set, each layer sent as values rebuilt from `font`'s
    /// copy of it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when `font` lacks a layer sent as
    /// values, [`CoreError::ChangeOriginMismatch`] when its values are not the
    /// change's before values, and the errors of
    /// [`GlyphLayer::apply_interpolation_values`] when the after values do not
    /// fit it.
    pub fn expand(self, font: &Font) -> CoreResult<FontChangeSet> {
        let changes = self
            .changes
            .into_iter()
            .map(|change| match change {
                CompactChange::Change(change) => Ok(change),
                CompactChange::LayerValues {
                    glyph_id,
                    layer_id,
                    before,
                    after,
                } => {
                    let current = font
                        .glyph(glyph_id)
                        .and_then(|glyph| glyph.layers().get(&layer_id))
                        .ok_or(CoreError::LayerNotFound(layer_id))?;
                    if current.interpolation_values().as_slice() != before.as_slice() {
                        return Err(CoreError::ChangeOriginMismatch {
                            target: "glyph layer values",
                        });
                    }
                    let mut next = GlyphLayer::clone(current);
                    next.apply_interpolation_values(&GlyphInterpolationValues::new(after))?;
                    Ok(FontChange::Layer {
                        glyph_id,
                        layer: Replacement::new(Some(Arc::clone(current)), Some(Arc::new(next))),
                        structural: false,
                    })
                }
            })
            .collect::<CoreResult<_>>()?;
        Ok(FontChangeSet::new(changes))
    }
}

/// `before`'s and `after`'s values, when `after` is `before` with only its
/// values changed.
fn values_only(before: &GlyphLayer, after: &GlyphLayer) -> Option<(Vec<f64>, Vec<f64>)> {
    let after_values = after.interpolation_values();
    let mut candidate = before.clone();
    candidate.apply_interpolation_values(&after_values).ok()?;
    (candidate == *after).then(|| {
        (
            before.interpolation_values().into_vec(),
            after_values.into_vec(),
        )
    })
}

#[cfg(test)]
mod tests;
