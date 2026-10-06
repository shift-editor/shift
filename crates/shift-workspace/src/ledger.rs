//! Undo ledger of reversible font changesets.
//!
//! One entry corresponds to one committed apply request. Undo applies the
//! entry's inverted changeset; redo applies the recorded changeset. The ledger
//! is in-memory: history survives a renderer reload while the workspace process
//! remains alive, but not a utility crash.

use shift_font::{FontChange, FontChangeSet, GlyphLayer, LayerId};

/// Maximum entries retained independently by each stack. The oldest entry on
/// the stack being extended falls off first; a fresh apply also clears redo.
const MAX_ENTRIES_PER_STACK: usize = 100;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct HistoryPosition(u64);

#[derive(Clone)]
pub struct LedgerEntry {
    position: HistoryPosition,
    pub label: Option<String>,
    pub change_set: FontChangeSet,
}

impl LedgerEntry {
    /// Layers whose current payloads must be resident before replay.
    pub(crate) fn layer_ids(&self) -> Vec<LayerId> {
        self.change_set
            .changes
            .iter()
            .flat_map(change_layer_ids)
            .collect()
    }
}

fn change_layer_ids(change: &FontChange) -> Vec<LayerId> {
    match change {
        FontChange::Glyph(value) => value
            .before
            .iter()
            .chain(value.after.iter())
            .flat_map(|glyph| glyph.layers().keys().cloned())
            .collect(),
        FontChange::Layer { layer, .. } => layer
            .before
            .iter()
            .chain(layer.after.iter())
            .map(|layer| GlyphLayer::id(layer))
            .collect(),
        FontChange::Metadata(_)
        | FontChange::LibValue { .. }
        | FontChange::Axes(_)
        | FontChange::AxisMappings(_)
        | FontChange::MetricDefinitions(_)
        | FontChange::NamedInstances(_)
        | FontChange::Sources(_) => Vec::new(),
    }
}

pub struct Ledger {
    undo: Vec<LedgerEntry>,
    redo: Vec<LedgerEntry>,
    base_position: HistoryPosition,
    saved_position: Option<HistoryPosition>,
    next_position: u64,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new(false)
    }
}

impl Ledger {
    pub fn new(dirty: bool) -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            base_position: HistoryPosition::default(),
            saved_position: (!dirty).then_some(HistoryPosition::default()),
            next_position: 1,
        }
    }

    /// Records an applied changeset. A fresh apply truncates the redo stack.
    pub fn push(&mut self, label: Option<String>, change_set: FontChangeSet) {
        self.redo.clear();
        let entry = LedgerEntry {
            position: HistoryPosition(self.next_position),
            label,
            change_set,
        };
        self.next_position += 1;
        push_undo_bounded(&mut self.undo, entry, &mut self.base_position);
    }

    /// Permanently removes every redo entry without changing the current or saved position.
    pub fn discard_redo(&mut self) {
        self.redo.clear();
    }

    /// Pops the entry to undo. The caller must return it after replay succeeds or fails.
    pub fn pop_undo(&mut self) -> Option<LedgerEntry> {
        self.undo.pop()
    }

    pub fn record_undone(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.redo, entry);
    }

    pub fn restore_undo(&mut self, entry: LedgerEntry) {
        push_undo_bounded(&mut self.undo, entry, &mut self.base_position);
    }

    /// Pops the entry to redo. The caller must return it after replay succeeds or fails.
    pub fn pop_redo(&mut self) -> Option<LedgerEntry> {
        self.redo.pop()
    }

    pub fn record_redone(&mut self, entry: LedgerEntry) {
        push_undo_bounded(&mut self.undo, entry, &mut self.base_position);
    }

    pub fn restore_redo(&mut self, entry: LedgerEntry) {
        push_bounded(&mut self.redo, entry);
    }

    pub fn mark_saved(&mut self) {
        self.saved_position = Some(self.current_position());
    }

    pub fn is_dirty(&self) -> bool {
        self.saved_position != Some(self.current_position())
    }

    pub fn is_entry_dirty(&self, entry: &LedgerEntry) -> bool {
        self.saved_position != Some(entry.position)
    }

    fn current_position(&self) -> HistoryPosition {
        self.undo
            .last()
            .map_or(self.base_position, |entry| entry.position)
    }
}

fn push_undo_bounded(
    stack: &mut Vec<LedgerEntry>,
    entry: LedgerEntry,
    base_position: &mut HistoryPosition,
) {
    stack.push(entry);
    if stack.len() > MAX_ENTRIES_PER_STACK {
        *base_position = stack.remove(0).position;
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
            ledger.push(Some(index.to_string()), FontChangeSet::default());
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
        ledger.push(Some("1".into()), FontChangeSet::default());
        let entry = ledger.pop_undo().unwrap();
        ledger.record_undone(entry);

        ledger.push(Some("2".into()), FontChangeSet::default());

        assert!(ledger.redo.is_empty());
        assert_eq!(ledger.undo.len(), 1);
    }

    #[test]
    fn discarding_redo_preserves_the_current_and_saved_positions() {
        let mut ledger = Ledger::default();
        ledger.push(Some("saved".into()), FontChangeSet::default());
        ledger.mark_saved();
        ledger.push(Some("later".into()), FontChangeSet::default());

        let later = ledger.pop_undo().unwrap();
        ledger.record_undone(later);
        assert!(!ledger.is_dirty());

        ledger.discard_redo();

        assert!(!ledger.is_dirty());
        assert!(ledger.pop_redo().is_none());
        assert_eq!(ledger.pop_undo().unwrap().label.as_deref(), Some("saved"));
    }

    #[test]
    fn saved_position_tracks_undo_redo_and_branches() {
        let mut ledger = Ledger::default();
        ledger.push(Some("first".into()), FontChangeSet::default());
        ledger.push(Some("saved".into()), FontChangeSet::default());
        ledger.mark_saved();
        ledger.push(Some("after save".into()), FontChangeSet::default());
        assert!(ledger.is_dirty());

        let after_save = ledger.pop_undo().unwrap();
        assert!(!ledger.is_dirty());
        ledger.record_undone(after_save);
        let after_save = ledger.pop_redo().unwrap();
        assert!(ledger.is_entry_dirty(&after_save));
        ledger.record_redone(after_save);

        let after_save = ledger.pop_undo().unwrap();
        ledger.record_undone(after_save);
        let saved = ledger.pop_undo().unwrap();
        ledger.record_undone(saved);
        ledger.push(Some("branch".into()), FontChangeSet::default());
        assert!(ledger.is_dirty());
    }

    fn entry(index: usize) -> LedgerEntry {
        LedgerEntry {
            position: HistoryPosition(index as u64),
            label: Some(index.to_string()),
            change_set: FontChangeSet::default(),
        }
    }
}
