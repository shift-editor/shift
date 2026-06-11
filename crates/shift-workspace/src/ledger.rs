//! Undo ledger: state-pair entries replayed through the normal apply path.
//!
//! Each applied intent set records pre/post `GlyphLayer` snapshots for every
//! touched layer. Undo restores the pre states, redo the post states — no
//! per-variant inversion algebra. The ledger is in-memory: history survives
//! a renderer reload (it lives with the workspace process), not a utility
//! crash; a SQLite ledger table is the later upgrade if that ever matters.

use shift_font::GlyphLayer;

/// Generous bound so a marathon session cannot grow memory unboundedly;
/// oldest entries fall off first.
const MAX_ENTRIES: usize = 100;

#[derive(Clone)]
pub struct LayerPair {
    pub pre: GlyphLayer,
    pub post: GlyphLayer,
}

#[derive(Clone)]
pub struct LedgerEntry {
    pub label: Option<String>,
    pub layers: Vec<LayerPair>,
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
