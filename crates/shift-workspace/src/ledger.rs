//! Undo ledger: state-pair entries replayed through the normal apply path.
//!
//! One entry corresponds to one apply request and holds the request's steps
//! in application order. Every step is a state pair — undo applies the `pre`
//! side of each step in reverse order, redo the `post` side in order — no
//! per-variant inversion algebra. The ledger is in-memory: history survives
//! a renderer reload (it lives with the workspace process), not a utility
//! crash; a SQLite ledger table is the later upgrade if that ever matters.

use shift_font::{
    Axis, AxisMapping, FontMetadata, Glyph, GlyphId, GlyphLayer, GlyphName, MetricDefinition,
    NamedInstance, Source, SourceId,
};

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
    /// hand the entry back — via [`Ledger::record_undone`] after the replay
    /// durably succeeded, or [`Ledger::restore_undo`] when it failed so the
    /// step stays available for retry.
    pub fn pop_undo(&mut self) -> Option<LedgerEntry> {
        self.undo.pop()
    }

    pub fn record_undone(&mut self, entry: LedgerEntry) {
        self.redo.push(entry);
    }

    /// Hands a popped undo entry back after a failed replay.
    pub fn restore_undo(&mut self, entry: LedgerEntry) {
        self.undo.push(entry);
    }

    /// Pops the entry to redo; hand back via [`Ledger::record_redone`] after
    /// the replay durably succeeded, or [`Ledger::restore_redo`] when it
    /// failed so the step stays available for retry.
    pub fn pop_redo(&mut self) -> Option<LedgerEntry> {
        self.redo.pop()
    }

    pub fn record_redone(&mut self, entry: LedgerEntry) {
        self.undo.push(entry);
    }

    /// Hands a popped redo entry back after a failed replay.
    pub fn restore_redo(&mut self, entry: LedgerEntry) {
        self.redo.push(entry);
    }
}
