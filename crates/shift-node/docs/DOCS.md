# shift-node

NAPI bindings that expose `shift-core` to the Node.js/Electron renderer process as a single `FontEngine` class.

## Architecture Invariants

**Architecture Invariant:** Only one `EditSession` may be active at a time. Starting a second session returns an error. **WHY:** The session borrows the glyph out of the `Font` (via `take_glyph`), so concurrent sessions would leave the font in an inconsistent state.

**Architecture Invariant:** All mutation methods return a JSON-serialized `CommandResult`, never raw values. **WHY:** The JS side parses a uniform `{success, snapshot, error, affectedPointIds, canUndo, canRedo}` shape, so the bridge never needs per-method return-type handling.

**Architecture Invariant: CRITICAL:** Entity IDs are stringified `u128` values when crossing the NAPI boundary. Parsing failures are returned as `CommandResult::error`, not NAPI exceptions. **WHY:** NAPI has no native u128 type, and bubbling parse failures as exceptions would crash the renderer process.

**Architecture Invariant:** `EngineLayerProvider` gives session-first layer resolution: the in-progress edit session layer shadows the persisted font layer for the currently-edited glyph. **WHY:** Composite glyphs that reference the glyph being edited must see unsaved changes (e.g. Aacute sees in-session edits to A), otherwise the canvas shows stale composites.

**Architecture Invariant:** `DependencyGraph` is rebuilt from scratch at the end of every edit session (`end_edit_session`), not incrementally. **WHY:** Component references may have changed during the session; a full rebuild is simple and correct for the current glyph count.

**Architecture Invariant: CRITICAL:** `set_positions` accepts `Option<Float64Array>` -- callers must pass `null` for empty arrays, not zero-length typed arrays. **WHY:** napi-rs panics on zero-length `Float64Array`.

## Codemap

```
crates/shift-node/
  src/
    lib.rs               -- crate root, re-exports font_engine module
    font_engine.rs       -- FontEngine struct, NAPI bindings, command helpers, tests
  Cargo.toml             -- cdylib crate; depends on shift-core, napi, serde_json
```

## Key Types

- `FontEngine` -- the single `#[napi]` class holding `Font`, `EditSession`, `DependencyGraph`
- `EngineLayerProvider` -- implements `GlyphLayerProvider` with session-first semantics for composite resolution
- `SaveFontTask` -- NAPI `Task` impl for async font saving (`save_font_async`)
- `JsNodeRef` -- tagged union (`kind` + `id` string) representing a point, anchor, or guideline across the NAPI boundary
- `JsNodePositionUpdate` -- pairs a `JsNodeRef` with `(x, y)` for batch position updates
- `JsGlyphRef` -- glyph name + optional unicode for session start
- `CommandResult` (from shift-core) -- uniform JSON result shape returned by all mutations
- `parse_or_err!` -- macro that parses a string ID into a typed ID or returns a `CommandResult::error`

## How it works

### Command pattern

Four internal helpers centralize the mutation-to-JSON pipeline. Each acquires the `EditSession`, runs a closure, builds a `CommandResult`, enriches it with composite contours, and serializes to JSON:

| Helper              | Closure signature                                     | Use when                                   |
|---------------------|-------------------------------------------------------|--------------------------------------------|
| `command`           | `&mut EditSession -> Vec<PointId>`                    | mutation returns affected point IDs        |
| `command_simple`    | `&mut EditSession -> ()`                              | mutation has no meaningful return           |
| `command_try`       | `&mut EditSession -> Result<Vec<PointId>, String>`    | mutation can fail with a domain error       |
| `command_try_simple`| `&mut EditSession -> Result<(), String>`              | fallible mutation, no affected IDs          |

All four delegate to `with_command_result`, which calls `serialize_enriched_result` to attach resolved composite contours before returning the JSON string.

### Session lifecycle

1. JS calls `start_edit_session(JsGlyphRef)`.
2. `FontEngine` calls `font.take_glyph()`, removing the glyph from the font store. It picks the most complex layer and creates an `EditSession` over it.
3. Mutations flow through the command helpers above.
4. `end_edit_session` moves the edited layer back into the glyph, puts the glyph back into the font, and rebuilds the `DependencyGraph`.

### Composite enrichment

Every `CommandResult` and `GlyphSnapshot` is enriched before leaving the NAPI boundary: `enrich_snapshot_with_composites` uses `EngineLayerProvider` to resolve component contours (session-first), then sets `snapshot.composite_contours`. This means the JS side always receives fully-flattened composite geometry without a second round-trip.

### Save path

`save_font` and `save_font_async` temporarily splice the in-session layer back into the font, clone it, then restore the original so the session is undisturbed. `save_font_async` wraps this in a `SaveFontTask` for non-blocking I/O.

### Zero-copy bulk updates

`set_positions` accepts `Float64Array` buffers (point IDs packed as f64, interleaved xy coords) for high-frequency drag operations, avoiding per-node NAPI object overhead.

## Workflow recipes

### Adding a new mutation method

1. Add the method to `EditSession` in shift-core.
2. In `font_engine.rs`, add a `#[napi]` method on `FontEngine`.
3. Choose the right command helper (`command`, `command_try`, etc.).
4. Parse any string IDs with `parse_or_err!`.
5. Run `cargo build -p shift-node` to verify.

### Adding a new read-only query

1. Add a `#[napi]` method that calls through to `Font` or `EditSession`.
2. For JSON results, use `to_json(...)`. For native returns, use NAPI-compatible types directly.
3. If the query needs to see in-session state, use `editing_target_for_unicode` or `editing_target_for_name` which implement session-first resolution.

## Gotchas

- **Glyph removed during session**: `take_glyph` removes the glyph from the font while a session is active. Code that iterates `font.glyphs()` during a session will not see the currently-edited glyph. `editing_target_for_unicode` and `glyph_layer_by_name` handle this by checking the session first.
- **Float64Array zero-length panic**: Passing a zero-length `Float64Array` to `set_positions` causes a napi-rs panic. Always pass `null` instead.
- **ID round-tripping precision**: IDs are `u128` cast through `u64` then `f64` in `set_positions`. This is safe for current ID ranges but would silently corrupt IDs above `2^53`.
- **Composite debug logging is compiled out**: The `composite_debug!` macro expands to nothing. To enable, change the macro body to `eprintln!`.

## Verification

```bash
# Build the native module
cargo build -p shift-node

# Run unit tests
cargo test -p shift-node

# Type-check the generated TS declarations (after napi build)
npx tsc --noEmit --project apps/desktop/tsconfig.json
```

## Related

- `EditSession` (shift-core) -- the Rust editing session this crate wraps
- `CommandResult`, `GlyphSnapshot` (shift-core snapshot) -- the serialization types returned across the boundary
- `GlyphLayerProvider` (shift-core composite) -- trait implemented by `EngineLayerProvider`
- `DependencyGraph` (shift-core) -- composite dependency tracking, rebuilt on session end
- `FontLoader`, `UfoWriter` (shift-core) -- font I/O used by `load_font` / `save_font`
- Preload bridge (`apps/desktop/src/preload/`) -- Electron contextBridge that exposes `FontEngine` to the renderer
