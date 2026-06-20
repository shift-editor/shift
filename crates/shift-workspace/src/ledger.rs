//! Undo ledger: state-pair entries replayed through the normal apply path.
//!
//! One entry corresponds to one apply request and holds the request's steps
//! in application order. Every step is a state pair — undo applies the `pre`
//! side of each step in reverse order, redo the `post` side in order — no
//! per-variant inversion algebra. The ledger is in-memory: history survives
//! a renderer reload (it lives with the workspace process), not a utility
//! crash; a SQLite ledger table is the later upgrade if that ever matters.

use shift_font::{Axis, Glyph, GlyphId, GlyphLayer, Source};

/// Generous bound so a marathon session cannot grow memory unboundedly;
/// oldest entries fall off first.
const MAX_ENTRIES: usize = 100;

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
    Axis {
        pre: Option<Axis>,
        post: Option<Axis>,
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
}

#[derive(Clone)]
pub struct LayerPair {
    pub pre: GlyphLayer,
    pub post: GlyphLayer,
}

#[derive(Clone)]
pub struct LedgerEntry {
    pub label: Option<String>,
    pub steps: Vec<LedgerStep>,
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
        self.undo.push(entry);

        if self.undo.len() > MAX_ENTRIES {
            self.undo.remove(0);
        }
    }

    /// Pops the entry to undo; the caller replays its pre states and must
    /// hand the entry back via [`Ledger::record_undone`] only after the
    /// replay durably succeeded.
    pub fn pop_undo(&mut self) -> Option<LedgerEntry> {
        self.undo.pop()
    }

    pub fn record_undone(&mut self, entry: LedgerEntry) {
        self.redo.push(entry);
    }

    /// Pops the entry to redo; hand back via [`Ledger::record_redone`] after
    /// the replay durably succeeded.
    pub fn pop_redo(&mut self) -> Option<LedgerEntry> {
        self.redo.pop()
    }

    pub fn record_redone(&mut self, entry: LedgerEntry) {
        self.undo.push(entry);
    }
}
