//! Undo ledger: state-pair entries replayed through the normal apply path.
//!
//! One entry corresponds to one apply request and holds the request's steps
//! in application order. Every step is a state pair — undo applies the `pre`
//! side of each step in reverse order, redo the `post` side in order — no
//! per-variant inversion algebra. The ledger is in-memory: history survives
//! a renderer reload (it lives with the workspace process), not a utility
//! crash; a SQLite ledger table is the later upgrade if that ever matters.

use std::sync::Arc;

use shift_font::{
    Axis, AxisMapping, FontMetadata, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId,
    MetricDefinition, NamedInstance, Source, SourceId,
};

/// Maximum entries retained independently by each stack. The oldest entry on
/// the stack being extended falls off first; a fresh apply also clears redo.
const MAX_ENTRIES_PER_STACK: usize = 100;

#[derive(Clone)]
pub enum LedgerStep {
    /// Edits to existing layers; pairs replay by substitution.
    Layers(Vec<LayerPair>),
    /// Glyph existence/identity: created (`pre` None), deleted (`post`
    /// None), or replaced. Snapshots carry the glyph's layers.
    Glyph {
        pre: Option<Glyph>,
        post: Option<Glyph>,
    },
    /// Complete authored metadata snapshots; font metrics are independent.
    FontMetadata {
        pre: FontMetadata,
        post: FontMetadata,
    },
    Axis {
        pre: Option<Axis>,
        post: Option<Axis>,
        /// Source location values on this axis at pre time. Deleting an
        /// axis strips them from every source, so restoring the axis
        /// restores them too.
        pre_locations: Vec<(SourceId, f64)>,
    },
    AxisMappings {
        pre: Vec<AxisMapping>,
        post: Vec<AxisMapping>,
    },
    /// Font-owned metric identities. Replay installs these before source
    /// snapshots so source values always validate against the intended side.
    MetricDefinitions {
        pre: Vec<MetricDefinition>,
        post: Vec<MetricDefinition>,
    },
    /// The complete authored product-preset collection. Replay applies this
    /// after axis topology so external locations validate on both sides.
    NamedInstances {
        pre: Vec<NamedInstance>,
        post: Vec<NamedInstance>,
    },
    /// Source existence. Sparse glyph-layer existence is represented by
    /// separate [`LedgerStep::GlyphLayer`] entries.
    Source {
        pre: Option<Source>,
        post: Option<Source>,
    },
    /// Independent glyph-layer existence for sparse source authoring.
    GlyphLayer {
        glyph_id: GlyphId,
        pre: Option<Box<GlyphLayer>>,
        post: Option<Box<GlyphLayer>>,
    },
    /// Glyph rename / unicode reassignment. Both sides always exist; the
    /// glyph and its layers are untouched.
    GlyphIdentity {
        glyph_id: GlyphId,
        pre: GlyphIdentity,
        post: GlyphIdentity,
    },
}

/// One side of a glyph identity change: the name and unicode assignments.
#[derive(Clone)]
pub struct GlyphIdentity {
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
}

#[derive(Clone)]
pub struct LayerPair {
    pub pre: Arc<GlyphLayer>,
    pub post: Arc<GlyphLayer>,
    /// Fixed when the entry is created. Both replay directions preserve
    /// topology when false and must publish complete structure when true.
    pub structural: bool,
}

#[derive(Clone)]
pub struct LedgerEntry {
    pub label: Option<String>,
    pub steps: Vec<LedgerStep>,
}

impl LedgerEntry {
    /// Layers whose persisted current values may be needed before replay.
    /// Snapshot-backed replay can then replace loaded authored state without
    /// leaving workspace residency bookkeeping pointed at a placeholder.
    pub(crate) fn layer_ids(&self) -> Vec<LayerId> {
        self.steps
            .iter()
            .flat_map(|step| match step {
                LedgerStep::Layers(pairs) => pairs
                    .iter()
                    .flat_map(|pair| [pair.pre.id(), pair.post.id()])
                    .collect(),
                LedgerStep::Glyph { pre, post } => pre
                    .iter()
                    .chain(post.iter())
                    .flat_map(|glyph| glyph.layers().keys().cloned())
                    .collect(),
                LedgerStep::GlyphLayer { pre, post, .. } => pre
                    .iter()
                    .chain(post.iter())
                    .map(|layer| layer.id())
                    .collect(),
                LedgerStep::FontMetadata { .. }
                | LedgerStep::Axis { .. }
                | LedgerStep::AxisMappings { .. }
                | LedgerStep::MetricDefinitions { .. }
                | LedgerStep::NamedInstances { .. }
                | LedgerStep::Source { .. }
                | LedgerStep::GlyphIdentity { .. } => Vec::new(),
            })
            .collect()
    }
}

#[derive(Default)]
pub struct Ledger {
    undo: Vec<LedgerEntry>,
    redo: Vec<LedgerEntry>,
}

impl Ledger {
    /// Records an applied entry. A fresh apply truncates the redo stack.
    pub fn push(&mut self, entry: LedgerEntry) {
        self.redo.clear();
        push_bounded(&mut self.undo, entry);
    }

    /// Pops the entry to undo; the caller replays its pre states and must
    /// hand the entry back — via [`Ledger::record_undone`] after the replay
    /// durably succeeded, or [`Ledger::restore_undo`] when it failed so the
    /// step stays available for retry.
    pub fn pop_undo(&mut self) -> Option<LedgerEntry> {
        self.undo.pop()
    }

    pub fn record_undone(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.redo, entry);
    }

    /// Hands a popped undo entry back after a failed replay.
    pub fn restore_undo(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.undo, entry);
    }

    /// Pops the entry to redo; hand back via [`Ledger::record_redone`] after
    /// the replay durably succeeded, or [`Ledger::restore_redo`] when it
    /// failed so the step stays available for retry.
    pub fn pop_redo(&mut self) -> Option<LedgerEntry> {
        self.redo.pop()
    }

    pub fn record_redone(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.undo, entry);
    }

    /// Hands a popped redo entry back after a failed replay.
    pub fn restore_redo(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.redo, entry);
    }
}

fn push_bounded(stack: &mut Vec<LedgerEntry>, entry: LedgerEntry) {
    stack.push(entry);
    if stack.len() > MAX_ENTRIES_PER_STACK {
        stack.remove(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_stack_drops_its_oldest_entry_independently() {
        let mut ledger = Ledger::default();
        for index in 0..=MAX_ENTRIES_PER_STACK {
            ledger.push(entry(index));
        }
        assert_eq!(ledger.undo.len(), MAX_ENTRIES_PER_STACK);
        assert_eq!(ledger.undo[0].label.as_deref(), Some("1"));

        let undo = std::mem::take(&mut ledger.undo);
        for entry in undo {
            ledger.record_undone(entry);
        }
        ledger.record_undone(entry(MAX_ENTRIES_PER_STACK + 1));
        assert_eq!(ledger.redo.len(), MAX_ENTRIES_PER_STACK);
        assert_eq!(ledger.redo[0].label.as_deref(), Some("2"));
    }

    #[test]
    fn fresh_apply_clears_the_bounded_redo_stack() {
        let mut ledger = Ledger::default();
        ledger.record_undone(entry(1));

        ledger.push(entry(2));

        assert!(ledger.redo.is_empty());
        assert_eq!(ledger.undo.len(), 1);
    }

    fn entry(index: usize) -> LedgerEntry {
        LedgerEntry {
            label: Some(index.to_string()),
            steps: Vec::new(),
        }
    }
}
