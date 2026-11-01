# shift-engine

<!-- reviewed: 2026-10-31 review-every: 90d -->

The editing session over a partly loaded font and the scene it is shown on, and its one undo history. The native workspace runs it against its SQLite store; the renderer runs the same code through WebAssembly against a native reader in its preload. It depends only on `shift-font`, `pack` and `serde`.

## Architecture Invariants

- **Architecture Invariant:** An edit never waits on anything asynchronous. `EngineSession` loads what an edit reads through a synchronous `LayerSource`, then stages the edit on an O(1) copy of the font. **WHY:** edits apply in the frame they are made; the editor windows already run unsandboxed, so the preload can read SQLite synchronously.
- **Architecture Invariant:** `EngineSession::load_reads` is the only place that decides what an edit reads beyond the layers it names: the glyphs the edited layers' components are built from (new components attach to their anchors), the glyphs new or decomposed components are built from, and the composites that follow an edited glyph's anchors, each with its component closure. Native and the renderer never keep their own copy of this rule.
- **Architecture Invariant:** An engine that runs apart from its store reads it through `StoreReader`, a `#[pack::interface]` request protocol with the `LayerSource` questions (`layers`, `bases_of`, `composites_of`) and a typed `StoreReadError`. The renderer's engine asks through the generated `StoreReaderClient`; the preload's native `LayerReader` answers with `store_reader_request`. **WHY:** both ends are Rust, so the requests are encoded and decoded by generated code from one trait, and JavaScript only passes the bytes on.
- **Architecture Invariant:** A `LayerSource` answers with persisted state. The session combines it with its own loaded layers, which can hold edits not yet persisted, and loading more than an edit needs is always safe.
- **Architecture Invariant:** Staging and committing are separate. A caller that persists commits only once the write succeeded, so a failed write leaves the session unchanged.
- **Architecture Invariant:** An edit that would change a placeholder fails with `EngineError::UnloadedLayerMutation`; placeholders are never persisted as authored content.
- **Architecture Invariant:** The scene (`scene::Scene`: pages, text runs and placed glyphs as typed `SceneNode`s) sits in the session beside the font, never inside it, so export and compilation, which read a `Font`, never see it. Scene edits are `SceneIntent`s (create, update, move and delete a node, set a run's items) and leave a `SceneChangeSet`, each node's value before and after; a refused intent leaves the scene unchanged. Pages are the roots; every other node has a parent that exists and is never its own ancestor; siblings sort by their fractional `index` (`shift_font::index_key`) and then by id. A scene copies in O(1) (`PersistentMap`), like a font. Every node carries a process-wide revision, and a text run an items revision that an update or move keeps (`RevisedNode`), so readers keep what they built from unchanged nodes without comparing them; an update never changes a run's items, which only `SetRunItems` does. **WHY:** server-side and agent-built pages need scene semantics in Rust, and a typed scene in the one ledger gives undo, unsaved state and persistence for free.
- **Architecture Invariant:** `EditHistory` is the document's one undo history: each step is a `DocumentChangeSet` (its font and scene changes together) with an `EditLocation`, the page shown when the edit was made (`begin(page)`; for an edit made with no page shown, the page of the first node it changed) and the glyphs and nodes it changed, which undo and redo hand back (`Replayed::location`) so the editor can show that page first. `Recording::Unrecorded` keeps an edit without an undo step (placing a run); the history then matches no saved position. A scene change counts as unsaved like a font change: there is no second unsaved record.

## Codemap

```
crates/shift-engine/src/
  lib.rs        -- public API
  session.rs    -- `EngineSession`: load, stage, commit, preview, evict
  residency.rs  -- `LayerResidency`: which directory layers are placeholders
  source.rs     -- `LayerSource`: where unloaded layers are read from
  records.rs    -- `RecordSource`, `RecordCache`; glyph records and the shaper font's source, from loaded layers and the store
  history.rs    -- `EditHistory`: the one undo history of document edits, `Recording`, `HistoryEntry`, `Replayed`
  document.rs   -- `DocumentChangeSet` (font and scene changes of one edit), `CompactDocumentChangeSet`, `EditLocation`
  scene/        -- `Scene`, `SceneNode` and its kinds, `SceneIntent`, `SceneChangeSet`, `SceneError`
  store_reader.rs -- `StoreReader`: the `LayerSource` questions as a request protocol, and `StoreReadError`
crates/shift-engine/tests/
  session_test.rs -- property test: a partly loaded session edits exactly as a fully loaded font
```

## Key Types

- `EngineSession` -- the font directory, its loaded layers, and which layers are still placeholders. Loads, stages, commits, and evicts.
- `StagedEdit` -- an applied edit on a copy of the font that is not part of the session yet: its font and its `FontChangeSet`.
- `LayerSource` -- a synchronous reader of persisted state: layer content, the glyphs given glyphs' components use (`bases_of`, transitively, without the glyphs themselves), and the glyphs built directly from given glyphs (`composites_of`).
- `RecordSource` -- what glyph records and the shaper font's source read from the store for layers the session has not loaded: persisted component bases, the layers that carry an anchor marks attach to (`attaching_anchor_layers`), and glyph data's categories. `EngineSession::glyph_records` and `EngineSession::shaper_font_source` answer from loaded layers first, so unsaved edits count, and load nothing.
- `RecordCache` -- the store's answers a session keeps: glyph data's category by name and codepoints (a pure function of both), and whether each layer the session has not loaded carries an attaching anchor (the store's copy cannot change until an edit loads it). `reading(source)` answers from it and asks `source` only for the rest. **WHY:** asking glyph data for all 10,000 glyphs took about 5 ms and the attaching-anchor read about 13 ms on every shaper source build; a session that evicts layers calls `forget_layers`
- `StoreReader`, `StoreReaderClient`, `StoreReadError` -- the same questions across a process or module boundary: layers and the scene's nodes (`scene_nodes`, read once when an engine opens) cross as one MessagePack blob each (`pack::Bytes`), ids by the names each message carries.
- `Scene`, `SceneNode`, `SceneIntent`, `SceneChangeSet` -- the document's canvas, its nodes, the edits a caller asks for, and what an edit changed.
- `DocumentChangeSet`, `EditLocation`, `EditHistory` -- one edit's font and scene changes, where it was made, and the history of them.
- `LayerResidency` -- which directory layers are placeholders.
- `EngineError`, `LoadError`, `ApplyError` -- a failed stage (the session is unchanged), a failed load (layers loaded before the failure stay loaded), and either from `apply`.

## How it works

`EngineSession::open_directory(font)` starts with every layer a placeholder; `open_loaded(font)` with every layer loaded. An edit then runs in three steps:

1. **Load.** `load_reads` loads the layers the intents name (`FontIntentSet::required_layer_ids`), then, now that those layers' components are known, the glyphs their components are built from (`FontIntentSet::component_bases`) and the glyphs built from layers with anchor edits (`FontIntentSet::layers_with_anchor_edits`), each with its component closure. Composites (asked for the glyphs owning those layers) and closures combine the source's persisted answer with the font's answer for loaded layers (`Font::dependent_glyph_ids`, `Font::component_glyph_ids_of_glyphs`), which can be ahead of it. The closure is a worklist: each glyph is asked about once, until neither answer finds a glyph not seen yet. Undo and redo load what a recorded change set touches (`load_changed`, from `FontChangeSet::changed_layer_ids` and every layer of `FontChangeSet::replaced_glyph_ids`).
2. **Stage.** `stage_intents` (or `stage_change_set` for undo and redo) applies to an O(1) copy of the font. A change to a layer that is still a placeholder fails with `EngineError::UnloadedLayerMutation`.
3. **Commit.** `commit` adopts the staged font. It sweeps residency only when the change can remove layers, because the sweep looks up every unloaded layer.

The editor's reads of the font are shift-font queries on `EngineSession::font`, the font as the session's edits left it, an open edit included: kerning between glyphs (`Font::kerning_blend_at`, `Font::kerning_blend_at_source`, `Kerning::editable_pair`) and source metrics between masters (`Font::source_metric_interpolation`). The session adds no read rules of its own; `shift-wasm` exports them (`engine_reads.rs`).

`apply` runs all three for callers that do not persist; `preview` loads and stages but never commits, for a gesture's preview in the editor. `FontWorkspace` stages, writes to its store, and commits only after the write succeeds. `evict` turns loaded layers back into placeholders that keep their width and height; every edit is persisted before it is committed, so eviction never loses work. `directory` returns the font with every layer a placeholder, what another session over the same store opens with; it replaces only the loaded layers, so the workspace hands a window its directory without reading the store again.

## Verification

```sh
cargo test -p shift-engine
PROPTEST_CASES=3000 cargo test --release -p shift-engine --test session_test
cargo check --target wasm32-unknown-unknown -p shift-engine
```

When a new intent reads glyphs other than the layers it names, extend `load_reads` (or `FontIntentSet::component_bases`) and add the intent to the property test's steps; the test compares every change set with a fully loaded font.

## Related

- `shift-font` -- the font model and the intents a session applies.
- `shift-workspace` -- runs `FontWorkspace` on an `EngineSession`, with its store as the `LayerSource`.
- `shift-store` -- the SQLite store the native workspace reads layers from.
- `shift-wasm` -- the WebAssembly build the renderer runs this session through.
- `shift-store` -- stores the scene one row per node (`scene_nodes`).
