//! Intents that act on whole glyphs, several at a time: the glyph grid's
//! batch actions.

use super::*;
use crate::linked_metrics::{MetricsKeyError, MetricsKeyEvaluator};

/// One glyph to copy, with the identity its copy takes.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphCopy {
    /// The glyph copied.
    pub glyph_id: GlyphId,
    /// Caller-minted id of the copy, so the caller can select it at once.
    pub copy_id: GlyphId,
}

/// Copies glyphs as one edit. A copy is named after its original with the
/// first free numbered suffix (`a.001`, `a.002`, …), has no code points, and
/// keeps the original's layers under new ids, its category, metrics keys,
/// mark colour and lib. It joins no kerning group.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct DuplicateGlyphs {
    pub copies: Vec<GlyphCopy>,
}

impl FontLevelIntent for DuplicateGlyphs {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        let originals = self.copies.iter().map(|copy| &copy.glyph_id);
        font.layer_ids_of_glyphs(originals).into_iter().collect()
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        for GlyphCopy { glyph_id, copy_id } in &self.copies {
            let copy = font.duplicate_of(*glyph_id, *copy_id)?;
            font.insert_glyph(copy)?;
        }
        let copy_ids = self.copies.iter().map(|copy| copy.copy_id).collect();
        Ok((Vec::new(), copy_ids))
    }
}

/// Turns every component of the glyphs into contours, in every layer, as one
/// edit: nested components are flattened too, and each glyph keeps its own
/// anchors. A glyph with no components is left as it is.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct DecomposeGlyphs {
    pub glyph_ids: Vec<GlyphId>,
}

impl FontLevelIntent for DecomposeGlyphs {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        font.layer_ids_of_glyphs(&self.glyph_ids)
            .into_iter()
            .collect()
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        let mut decomposed = Vec::new();
        for glyph_id in &self.glyph_ids {
            font.require_glyph(*glyph_id)?;
        }
        for layer_id in font.layer_ids_of_glyphs(&self.glyph_ids) {
            let component_ids: Vec<ComponentId> = font
                .require_layer(layer_id)?
                .components_iter()
                .map(Component::id)
                .collect();
            if component_ids.is_empty() {
                continue;
            }
            font.decompose_components(layer_id, &component_ids)?;
            decomposed.push(layer_id);
        }
        Ok((decomposed, Vec::new()))
    }
}

/// Which of a glyph's layers a batch edit changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum LayerScope {
    /// The glyph's layer in one source.
    Source(SourceId),
    /// Its layer in every master.
    EveryMaster,
}

/// What a batch edit does to one sidebearing of each glyph.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum SidebearingEdit {
    /// Leaves the side as it is.
    Keep,
    /// Gives the side this value in font units, first clearing the keys that
    /// would pull it back, as typing a value in the sidebar does.
    Set(f64),
    /// Adds this many font units to the side, and leaves a side a key links
    /// alone.
    Adjust(f64),
    /// Links the side with this key, as typing it in the sidebar does.
    Link(String),
}

/// Edits the left and right sidebearings of several glyphs as one edit. A
/// glyph with no outline in a layer has no sidebearings there, so setting or
/// adjusting skips it; linking does not. Glyphs are edited base before
/// composite, so a composite ends with the value asked for even when a glyph
/// it is built from moves in the same edit.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct SetSidebearings {
    pub glyph_ids: Vec<GlyphId>,
    pub scope: LayerScope,
    pub left: SidebearingEdit,
    pub right: SidebearingEdit,
}

impl SetSidebearings {
    /// The layers the edit changes: each glyph's in the scope's sources.
    fn target_layers(&self, font: &Font) -> Vec<LayerId> {
        let glyphs = self.glyph_ids.iter().filter_map(|id| font.glyph(*id));
        match self.scope {
            LayerScope::Source(source_id) => glyphs
                .filter_map(|glyph| glyph.layer_for_source(source_id))
                .map(GlyphLayer::id)
                .collect(),
            LayerScope::EveryMaster => glyphs
                .flat_map(|glyph| font.masters_with_layers(glyph))
                .map(|(_, layer)| layer.id())
                .collect(),
        }
    }
}

impl FontLevelIntent for SetSidebearings {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        self.target_layers(font)
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Vec<GlyphId>)> {
        for glyph_id in &self.glyph_ids {
            font.require_glyph(*glyph_id)?;
        }
        for edit in [&self.left, &self.right] {
            if let SidebearingEdit::Set(value) | SidebearingEdit::Adjust(value) = edit {
                [*value].require_finite(Coordinates::SidebearingDelta)?;
            }
        }

        let mut layer_ids = self.target_layers(font);
        layer_ids.sort_by_cached_key(|layer_id| {
            font.glyph_id_by_layer(*layer_id)
                .map(|glyph_id| font.component_depth(glyph_id))
        });
        for layer_id in &layer_ids {
            font.edit_sidebearing(*layer_id, MetricsKeySide::Left, &self.left)?;
            font.edit_sidebearing(*layer_id, MetricsKeySide::Right, &self.right)?;
        }
        Ok((layer_ids, self.glyph_ids.clone()))
    }
}

impl Font {
    /// A copy of `glyph_id` to insert as `copy_id`: see [`DuplicateGlyphs`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::GlyphNotFound`] when the font has no `glyph_id`.
    fn duplicate_of(&self, glyph_id: GlyphId, copy_id: GlyphId) -> CoreResult<Glyph> {
        let original = self.require_glyph(glyph_id)?;
        let mut copy = Glyph::with_id(copy_id, self.next_duplicate_glyph_name(original.name()));
        copy.set_category(original.category());
        copy.set_sub_category(original.sub_category());
        copy.set_mark_color(original.mark_color());
        *copy.metrics_keys_mut() = original.metrics_keys().clone();
        *copy.lib_mut() = original.lib().clone();
        for layer in original.layers().values() {
            copy.set_layer(layer.clone_with_fresh_ids(LayerId::new(), layer.source_id()));
        }
        Ok(copy)
    }

    /// How many levels of components `glyph_id` is built from: 0 for a glyph
    /// with none, one more than its deepest base otherwise. A glyph in a
    /// component cycle counts each glyph once.
    fn component_depth(&self, glyph_id: GlyphId) -> usize {
        self.component_depth_below(glyph_id, &mut Vec::new())
    }

    /// [`Self::component_depth`] of `glyph_id`, given the glyphs already
    /// being measured above it.
    fn component_depth_below(&self, glyph_id: GlyphId, above: &mut Vec<GlyphId>) -> usize {
        let Some(glyph) = self.glyph(glyph_id) else {
            return 0;
        };
        if above.contains(&glyph_id) {
            return 0;
        }
        above.push(glyph_id);
        let deepest = glyph
            .component_glyph_ids()
            .map(|base| self.component_depth_below(base, above) + 1)
            .max();
        above.pop();
        deepest.unwrap_or(0)
    }

    /// Applies one side's [`SidebearingEdit`] to a layer.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] or [`CoreError::SourceNotFound`]
    /// when the layer or its source is missing.
    fn edit_sidebearing(
        &mut self,
        layer_id: LayerId,
        side: MetricsKeySide,
        edit: &SidebearingEdit,
    ) -> CoreResult<()> {
        let delta = match edit {
            SidebearingEdit::Keep => return Ok(()),
            SidebearingEdit::Link(key) => return self.link_metrics_side(layer_id, side, key),
            SidebearingEdit::Set(value) => {
                let Some(current) = self.sidebearing(layer_id, side)? else {
                    return Ok(());
                };
                self.clear_metrics_keys(layer_id, side.sides_holding())?;
                value - current
            }
            SidebearingEdit::Adjust(delta) => {
                if self.sidebearing(layer_id, side)?.is_none()
                    || self.side_is_held(layer_id, side)?
                {
                    return Ok(());
                }
                *delta
            }
        };
        self.move_side(layer_id, side, delta)
    }

    /// One sidebearing of a layer's glyph as its source draws it, components
    /// included, or `None` when it draws nothing there.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::LayerNotFound`] when the layer is missing, and
    /// the font's error when its source or a component cannot be resolved.
    fn sidebearing(&self, layer_id: LayerId, side: MetricsKeySide) -> CoreResult<Option<f64>> {
        let glyph_id = self.require_layer_owner(layer_id)?;
        let source_id = self.require_layer(layer_id)?.source_id();
        let measured = MetricsKeyEvaluator::new(self, source_id)
            .and_then(|mut evaluator| evaluator.current(glyph_id, side));
        match measured {
            Ok(value) => Ok(Some(value)),
            Err(MetricsKeyError::Font(error)) => Err(error),
            // Nothing drawn to measure from: the glyph has no sidebearing here.
            Err(_) => Ok(None),
        }
    }

    /// Whether a key holds `side` of a layer's glyph in the layer's source:
    /// a key on the side itself, or on the side that sets the same edge.
    fn side_is_held(&self, layer_id: LayerId, side: MetricsKeySide) -> CoreResult<bool> {
        let glyph = self.require_glyph(self.require_layer_owner(layer_id)?)?;
        let source_id = self.require_layer(layer_id)?.source_id();
        Ok(side
            .sides_holding()
            .iter()
            .any(|holding| glyph.metrics_key(source_id, *holding).is_some()))
    }
}
