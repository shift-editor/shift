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
  read_set.rs  -- `ReadSet`: what an edit reads
  residency.rs  -- `LayerResidency`: which directory layers are placeholders
  source.rs     -- `LayerSource`: where unloaded layers are read from
crates/shift-engine/tests/
  session_test.rs -- property test: a partly loaded session edits exactly as a fully loaded font
```

## Verifying

```sh
cargo test -p shift-engine
PROPTEST_CASES=3000 cargo test --release -p shift-engine --test session_test
cargo check --target wasm32-unknown-unknown -p shift-engine
```

When a new intent reads glyphs other than the layers it names, extend `ReadSet` and add the intent to the property test's steps; the test compares every change set with a fully loaded font.
