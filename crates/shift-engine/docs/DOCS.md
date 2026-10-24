# shift-engine

<!-- reviewed: 2026-10-24 review-every: 90d -->

The editing session over a partly loaded font. The native workspace runs it against its SQLite store; the renderer will run the same code through WebAssembly against a native reader in its preload. It depends only on `shift-font`.

## Architecture Invariants

- **Architecture Invariant:** An edit never waits on anything asynchronous. `EngineSession` loads what an edit reads through a synchronous `LayerSource`, then stages the edit on an O(1) copy of the font. **WHY:** edits apply in the frame they are made; the editor windows already run unsandboxed, so the preload can read SQLite synchronously.
- **Architecture Invariant:** `ReadSet` is the only place that decides what an edit reads beyond the layers it names: the glyphs the edited layers' components are built from (new components attach to their anchors), the glyphs new or decomposed components are built from, and the composites that follow an edited glyph's anchors, each with its component closure. Native and the renderer never keep their own copy of this rule.
- **Architecture Invariant:** A `LayerSource` answers with persisted state. The session combines it with its own loaded layers, which can hold edits not yet persisted, and loading more than an edit needs is always safe.
- **Architecture Invariant:** Staging and committing are separate. A caller that persists commits only once the write succeeded, so a failed write leaves the session unchanged.
- **Architecture Invariant:** An edit that would change a placeholder fails with `EngineError::UnloadedLayerMutation`; placeholders are never persisted as authored content.

## Codemap

```
crates/shift-engine/src/
  lib.rs        -- public API
  session.rs    -- `EngineSession`: load, stage, commit, evict
  read_set.rs   -- `ReadSet`: what an edit reads
  residency.rs  -- `LayerResidency`: which directory layers are placeholders
  source.rs     -- `LayerSource`: where unloaded layers are read from
crates/shift-engine/tests/
  session_test.rs -- property test: a partly loaded session edits exactly as a fully loaded font
```

## Key Types

- `EngineSession` -- the font directory, its loaded layers, and which layers are still placeholders. Loads, stages, commits, and evicts.
- `StagedEdit` -- an applied edit on a copy of the font that is not part of the session yet: its font and its `FontChangeSet`.
- `LayerSource` -- a synchronous reader of persisted state: layer content, a glyph's component closure, and the glyphs built from given layers.
- `ReadSet` -- what an edit reads beyond the layers it names: component bases and layers with anchor edits.
- `LayerResidency` -- which directory layers are placeholders.
- `EngineError`, `LoadError`, `ApplyError` -- a failed stage (the session is unchanged), a failed load (layers loaded before the failure stay loaded), and either from `apply`.

## How it works

`EngineSession::open_directory(font)` starts with every layer a placeholder; `open_loaded(font)` with every layer loaded. An edit then runs in three steps:

1. **Load.** `load_for_intents` loads the layers the intents name, then asks `ReadSet::for_intents` what else they read, now that those layers' components are known. It loads the component bases and the glyphs built from layers with anchor edits, each with its component closure. Dependents and closures combine the source's persisted answer with the session's loaded components, which can be ahead of it, and the closure repeats until neither adds a glyph. Undo and redo load what a recorded change set touches (`load_for_change_set`).
2. **Stage.** `stage_intents` (or `stage_change_set` for undo and redo) applies to an O(1) copy of the font. A change to a layer that is still a placeholder fails with `EngineError::UnloadedLayerMutation`.
3. **Commit.** `commit` adopts the staged font. It sweeps residency only when the change can remove layers, because the sweep looks up every unloaded layer.

`apply` runs all three for callers that do not persist. `FontWorkspace` stages, writes to its store, and commits only after the write succeeds. `evict` turns loaded layers back into placeholders that keep their width and height; every edit is persisted before it is committed, so eviction never loses work.

## Verification

```sh
cargo test -p shift-engine
PROPTEST_CASES=3000 cargo test --release -p shift-engine --test session_test
cargo check --target wasm32-unknown-unknown -p shift-engine
```

When a new intent reads glyphs other than the layers it names, extend `ReadSet` and add the intent to the property test's steps; the test compares every change set with a fully loaded font.

## Related

- `shift-font` -- the font model and the intents a session applies.
- `shift-workspace` -- runs `FontWorkspace` on an `EngineSession`, with its store as the `LayerSource`.
- `shift-store` -- the SQLite store the native workspace reads layers from.
- `shift-wasm` -- the WebAssembly build the renderer will run this session through.
