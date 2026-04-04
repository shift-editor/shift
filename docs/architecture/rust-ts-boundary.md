# Rust / TypeScript Boundary

> How the native Rust core (`shift-core`, `shift-ir`) communicates with the
> TypeScript renderer through the NAPI binding layer (`shift-node`).

---

## 1. Intended Design

### What Rust Owns

| Domain                          | Crate                                       | Notes                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font I/O (UFO, Glyphs, TTF/OTF) | `shift-core` (`font_loader`, `binary`)      | All file reading/writing happens in Rust. TS never touches font bytes.                                                                                                        |
| IR data model                   | `shift-ir`                                  | `Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, `Anchor`, `Transform`, all ID types. Single source of truth.                                                               |
| Geometry math                   | `shift-core` (`curve`, `vec2`, `composite`) | Bezier bounds, SVG path generation, bounding boxes, composite flattening.                                                                                                     |
| Component resolution            | `shift-core` (`composite`)                  | Flattening composites, anchor-driven placement, cycle detection. Uses `GlyphLayerProvider` trait so the NAPI layer can inject session-aware resolution.                       |
| Edit session                    | `shift-core` (`edit_session`)               | Mutable editing buffer. All point/contour/anchor mutations happen here. Returns `CommandResult` with a new snapshot after every operation.                                    |
| Dependency graph                | `shift-core` (`dependency_graph`)           | "What glyphs depend on this component?" queries.                                                                                                                              |
| Snapshot serialization          | `shift-core` (`snapshot`)                   | `GlyphSnapshot`, `CommandResult`, `PointSnapshot`, `ContourSnapshot`, etc. Defined once in Rust with `serde::Serialize` + `ts_rs::TS` so TypeScript types are auto-generated. |

### What TypeScript Owns

| Domain                    | Location               | Notes                                                                                                      |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Reactive state            | `engine/FontEngine.ts` | `$glyph: Signal<GlyphSnapshot \| null>` drives the UI. Managers update it; the rest of the app subscribes. |
| Canvas rendering          | renderer layer         | Drawing glyphs, handles, guides. Uses browser Canvas/Path2D APIs.                                          |
| Tool system & interaction | `lib/tools/`           | Pen tool, select tool, text tool behavior. Event handling, hit testing.                                    |
| Undo/redo stack           | TS-side                | Manages snapshot history.                                                                                  |
| UI chrome                 | Solid.js components    | Panels, menus, sidebars.                                                                                   |

### What the NAPI Layer (`shift-node`) Owns

The binding layer is in `crates/shift-node/src/font_engine.rs`. Its job:

1. **Marshalling.** Convert between NAPI-compatible types and `shift-core` types. All complex results cross the boundary as JSON strings via a `to_json()` helper. IDs cross as strings parsed with `.parse()`.

2. **Session-aware composite resolution.** `EngineLayerProvider` implements `GlyphLayerProvider` to serve the in-progress edit session's layer when resolving composites that reference the glyph being edited. This is the one piece of "logic" that lives here intentionally — it's a NAPI-specific concern because only the binding layer knows about both the persistent `Font` and the transient `EditSession`.

3. **Snapshot enrichment.** `enrich_snapshot_with_composites()` tacks resolved composite contours onto a `GlyphSnapshot` before returning it to TS. This calls into `shift-core` composite resolution but orchestrates it at the binding layer.

4. **Edit session lifecycle.** Starting/ending sessions, extracting the right glyph and layer from the font, backing up state. This is orchestration, not domain logic.

### The Data Contract

```
TS  ──(method call + primitives/JSON)──>  shift-node  ──(Rust types)──>  shift-core
TS  <──(JSON string)────────────────────  shift-node  <──(CommandResult)──  shift-core
```

- **Rust -> TS:** Almost everything is a JSON string. `getSnapshotData()`, `getMetrics()`, `getMetadata()`, all editing commands — they return `String` and TS calls `JSON.parse()`.
- **TS -> Rust:** Method parameters are primitives (`f64`, `u32`, `String`, `bool`) or simple NAPI objects (`JsGlyphRef`, `JsNodeRef`, `JsNodePositionUpdate`). Paste uses a JSON string (`contours_json`).
- **Exception:** `getGlyphBbox()` returns `Vec<f64>` (a raw `[x1, y1, x2, y2]` tuple), not JSON.
- **Exception:** `setNodePositions()` / `setPointPositions()` return `bool` directly — fire-and-forget drag operations that skip snapshot overhead.

### Type Generation

Types are **generated, not duplicated.** Rust structs in `shift-core` and `shift-ir` derive `ts_rs::TS`. Running `cargo test --package shift-core --package shift-ir` writes `.ts` files to `packages/types/src/generated/`. These are the canonical TypeScript definitions for `GlyphSnapshot`, `CommandResult`, `FontMetrics`, `FontMetadata`, `PointSnapshot`, `ContourSnapshot`, `RenderContourSnapshot`, etc.

TS adds branded ID types (`PointId`, `ContourId`, `AnchorId`) in `packages/types/src/ids.ts` for compile-time safety. These are string-branded — they don't add runtime overhead and don't conflict with Rust's integer-based IDs that serialize as strings.

---

## 2. Known Drift

### 2a. Geometric constraint logic lives in TypeScript

**Where:** `packages/rules/src/constraints.ts`, `packages/rules/src/actions.ts`

`maintainTangency()` and `maintainCollinearity()` do vector math (normalize, dot product, projection) to enforce Bezier handle constraints during drag. This runs on every pointer-move event. It's currently pure TS using `@shift/geo` Vec2 utilities.

**Why it drifted:** The rules/constraint system was built as a TS-side concern — it's about interaction behavior, not font data. But the actual math (tangent projection, collinear enforcement) is domain geometry that `shift-core` already has infrastructure for (`vec2.rs`, `curve.rs`).

**Risk:** Low for now. The math is simple and the TS implementation works. If constraints get more complex (e.g., curve fitting, multi-point smoothing), doing it in Rust avoids reimplementing curve math.

### 2b. Text layout positioning is TypeScript-side

**Where:** `apps/desktop/src/renderer/src/lib/tools/text/layout.ts`

`computeTextLayout()` iterates glyphs and computes cumulative x-positions from advances. Hit testing (`hitTestTextSlot`, `hitTestTextCaret`) does geometric range checks and Canvas Path2D intersection tests.

**Why it's here:** Hit testing requires browser APIs (`Path2D`, `isPointInPath`). The slot-positioning math is trivial (cumulative addition of advances). Moving it to Rust would mean marshalling the entire layout result back.

**Risk:** Low. This is inherently a rendering/interaction concern. The 600-unit fallback for non-spacing glyphs (`resolveEditorAdvance`) duplicates `DEFAULT_X_ADVANCE` from `shift-core/constants.rs` — that's the only real smell.

### 2c. Optimistic glyph updates bypass Rust

**Where:** `apps/desktop/src/renderer/src/engine/editing.ts`, `#applyNodePositionUpdatesToGlyph()`

During drags, TS applies position deltas directly to the `GlyphSnapshot` signal for immediate visual feedback, then separately calls `setNodePositions()` on the native side. The native call returns `bool` (not a new snapshot), so the two representations can briefly diverge.

**Why it's here:** Performance. Marshalling a full snapshot on every pointer-move is too expensive. The optimistic approach gives 60fps drags.

**Risk:** Medium. If the optimistic TS transform ever disagrees with how Rust would apply the same delta, the glyph "jumps" when the next real snapshot arrives. Currently they agree because both do simple coordinate addition — but if Rust ever adds snapping, grid alignment, or constraint enforcement at the `set_node_positions` level, the TS optimistic path won't know about it.

### 2d. Bounds construction is split

**Where:** `FontEngine.ts` lines 128-139, `packages/geo/src/Bounds.ts`

Rust returns bbox as `[x1, y1, x2, y2]` tuples. TS wraps them in `Bounds.create()`. This is a minor adapter concern, not real drift — but it means TS has its own Bounds abstraction that doesn't come from Rust.

**Risk:** None. This is fine.

### 2e. Mock FontEngine reimplements the contract

**Where:** `apps/desktop/src/renderer/src/engine/mock.ts`

A full in-memory mock of the `FontEngineAPI` interface for tests. It reimplements glyph storage, editing, snapshots — basically a parallel toy implementation of what Rust does.

**Risk:** Medium. If the Rust behavior changes (new fields in snapshots, new command semantics), the mock can silently drift. Tests pass against the mock but fail against real Rust. Consider generating the mock or using integration tests against the real native module.

---

## 3. How to Expose New Font Data to the Frontend

### Step-by-step: adding a new field or query

**Example:** You want to expose a glyph's `note` field (a string annotation) to the TS renderer.

#### 1. Add the field to the snapshot (if it belongs in glyph state)

In `crates/shift-core/src/snapshot.rs`, add the field to `GlyphSnapshot`:

```rust
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GlyphSnapshot {
    // ... existing fields ...
    pub note: Option<String>,  // <-- new
}
```

Update `GlyphSnapshot::from_edit_session()` to populate it.

#### 2. Regenerate TypeScript types

```bash
cargo test --package shift-core --package shift-ir
```

This writes updated `.ts` files to `packages/types/src/generated/`. The new field appears automatically in the TypeScript `GlyphSnapshot` type. **Do not hand-edit the generated files.**

#### 3. No changes needed in shift-node (for snapshot fields)

The NAPI layer serializes `GlyphSnapshot` as JSON. New fields flow through automatically because `serde` serializes them and `JSON.parse()` on the TS side picks them up.

#### 4. Use it in TypeScript

The `$glyph` signal in `FontEngine` already carries the full `GlyphSnapshot`. Access `snapshot.note` wherever you need it.

### If you need a new standalone query (not part of the snapshot)

#### 1. Add the computation in `shift-core`

Put the logic in the appropriate module (e.g., a method on `Font`, `Glyph`, or a free function).

#### 2. Expose it in `shift-node`

In `crates/shift-node/src/font_engine.rs`, add a `#[napi]` method on `FontEngine`:

```rust
#[napi]
pub fn get_glyph_note(&self, glyph_name: String) -> Option<String> {
    let font = self.font.as_ref()?;
    let glyph = font.glyph(&glyph_name)?;
    glyph.note().map(|s| s.to_string())
}
```

**Rules for NAPI methods:**

- Return primitives, `Option<primitive>`, `Vec<primitive>`, or `String` (JSON) for complex types.
- Use `to_json()` for anything with nested structure.
- Accept primitives or `#[napi(object)]` structs as parameters.
- Parse string IDs with `.parse()` and handle errors with `napi::Error`.

#### 3. Add it to the bridge interface

In `apps/desktop/src/shared/bridge/FontEngineAPI.ts`:

```typescript
getGlyphNote(glyphName: string): string | null;
```

#### 4. Wire it through the manager

Add a pass-through in the appropriate manager (probably `InfoManager` in `engine/info.ts`) and expose it on the `FontEngine` facade.

#### 5. Update the mock

If tests use `mock.ts`, add the method there too.

### Decision guide: snapshot field vs. standalone query?

| Use a snapshot field when...                                  | Use a standalone query when...           |
| ------------------------------------------------------------- | ---------------------------------------- |
| The data changes during editing and the UI needs live updates | The data is read-once or rarely accessed |
| It's part of the glyph's visual/structural state              | It's metadata or a derived computation   |
| Multiple UI components need it reactively                     | Only one call site needs it              |

### What NOT to do

- **Don't define types by hand in TypeScript** that mirror Rust structs. Use `ts-rs` generation. If you need a type that Rust doesn't know about, it belongs in `packages/types/src/` (not `generated/`).
- **Don't put domain logic in `shift-node`.** If you're writing `if/else` or math in `font_engine.rs`, it probably belongs in `shift-core`. The binding layer should orchestrate, not compute.
- **Don't return complex objects as NAPI structs.** Use JSON strings for anything with nesting. NAPI object mapping is fragile and doesn't support enums, optionals-of-objects, or nested vecs well.
- **Don't add TS-side geometric math** unless it genuinely requires browser APIs (Canvas, Path2D, DOM measurements). If it's pure coordinate math, put it in Rust.

---

## 4. The Three Mutation Tiers

Every glyph mutation in the editor falls into one of three tiers, distinguished
by how much work crosses the Rust boundary and how expensive the round-trip is.

### Tier 1: TS-only preview (no Rust round-trip)

**Purpose:** Immediate visual feedback during drags/interactions at 60fps.

**How it works:** Clone the base `GlyphSnapshot`, patch point/anchor positions
in TypeScript, emit the patched snapshot to the `$glyph` signal. Rust never
sees these intermediate states.

**Where:** `Editor.#previewNodePositions()` builds a new snapshot by
index-lookup into the base snapshot's contours/anchors arrays.

**Cost:** Zero NAPI calls. One shallow clone + signal emit per frame.

**Risk:** The preview snapshot can diverge from what Rust would produce if Rust
applies constraints, snapping, or normalization. Currently safe because
previews only change `x`/`y` coordinates, which Rust treats as passthrough.

### Tier 2: Lightweight Rust sync (bool return, no snapshot)

**Purpose:** Tell Rust "these positions changed" without paying for full
snapshot serialization and composite enrichment.

**Where (current):**

- `setNodePositions(updates)` → `raw.setNodePositions()` returns `bool`
- `setPointPositions(moves)` → `raw.setPointPositions()` returns `bool`

**Where (GPU branch, in progress):**

- `moveNodesLight(nodes, dx, dy)` → delta move, returns `bool`
- `movePointsAndAnchorsLight(pointIds, anchorIds, dx, dy)` → split ID variant
- `prepareNodeTransformLight(pointIds, anchorIds)` → cache transform targets
- `applyPreparedNodeTransformLight(transform)` → apply affine matrix to cached targets
- `clearPreparedNodeTransformLight()` → release cached targets

**Cost:** One NAPI call, no JSON serialization of results, no composite
enrichment. The `Light` suffix convention signals "no snapshot return."

**Risk:** Rust's internal state updates but the TS `$glyph` signal is NOT
refreshed from Rust — the preview snapshot (Tier 1) is what the UI shows.
If commit happens without a Tier 3 call afterward, the next `getSnapshotData()`
must agree with what TS previewed.

### Tier 3: Full command dispatch (JSON CommandResult with snapshot)

**Purpose:** Discrete mutations that produce a new canonical snapshot —
addPoint, removePoints, toggleSmooth, closeContour, etc.

**How it works:** NAPI method returns a JSON string containing
`{ success, snapshot, affectedPointIds, error }`. The snapshot includes
re-enriched composite contours. TS parses the JSON, validates success,
emits the snapshot to the `$glyph` signal.

**Where:** `EditingManager.#execute()` → `#dispatch()` / `#dispatchVoid()`.

**Cost:** Full JSON serialization of `CommandResult` + composite enrichment.
Acceptable for discrete operations (user clicks), too expensive for
per-frame drags.

### How the tiers compose: NodePositionPreviewSession

The `NodePositionPreviewSession` pattern (on the GPU branch as
`Editor.#createNodePositionPreviewSession`) orchestrates all three tiers
into a `preview/commit/cancel` lifecycle:

```
preview(updates)  → Tier 1: TS-only glyph patch, every frame
commit()          → Tier 2: sync to Rust (light), record undo command
cancel()          → Restore base snapshot, no Rust call
```

The three drag operations (translate, rotate, resize) differ only in how
they **build updates** from user input, not in the preview/commit/cancel
lifecycle:

| Drag type | Input → Updates                                               |
| --------- | ------------------------------------------------------------- |
| Translate | `delta` → add delta to base positions (with constraint rules) |
| Rotate    | `angle + origin` → `Vec2.rotateAround` each point             |
| Resize    | `scaleX, scaleY + origin` → scale offset from origin          |

All three feed their updates into the same `PreviewSession.preview()`.

### Design implications

1. **`dispatchCommand()` (Tier 3) is not the only reusable core.** The preview
   session lifecycle (Tier 1 + 2 composition) is equally fundamental.

2. **Tier boundaries should be explicit in the API.** Methods that do Tier 2
   (light sync) should be visually distinct from Tier 3 (full dispatch).
   The GPU branch's `Light` suffix is one convention.

3. **The mock must implement all three tiers.** `MockFontEngine` currently
   implements Tier 3 (full command mocking) and the GPU branch adds Tier 2
   (`moveNodesLight`, `prepareNodeTransformLight`, etc.). This is the main
   source of mock complexity growth.

4. **Preview session extraction is the next architectural step.** Currently
   `#createNodePositionPreviewSession` is a private method on Editor that
   returns a closure object. Extracting it would let tools and commands
   create preview sessions without going through Editor's 2000+ line surface.

---

## 5. Current Indirection Problem

### The edit call chain

A typical Tier 3 edit (e.g. `removePoints`) crosses these layers:

```
Tool / Behavior
  → editor.removePoints(ids)                  // Editor.ts — 0 logic, delegates
    → fontEngine.editing.removePoints(ids)     // EditingManager — 0 logic
      → #dispatchVoid(raw.removePoints(ids))   // dispatch pattern — real work
        → raw.removePoints(ids)                // NAPI call
```

Four TS layers, two adding zero logic. The reusable part is the dispatch
pattern (`#execute`, `#dispatch`, `#dispatchVoid`) — ~25 lines of real code.
Everything else is method-per-method forwarding.

### Pass-through layers

| Layer            | Lines | Logic added                                                                                                     |
| ---------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `EditingManager` | 342   | ~50 lines real (dispatch + optimistic updates). 15+ methods are identical `#dispatchVoid(raw.foo())` one-liners |
| `InfoManager`    | 95    | 0 — every method is `return this.#engine.getX()`                                                                |
| `IOManager`      | 23    | 0 — 2 methods, pure forward                                                                                     |
| `FontManager`    | 61    | 0 — 8 methods, pure forward                                                                                     |

### What a flatter design looks like

Extract the dispatch pattern as a free function:

```typescript
function dispatchCommand(json: string, emit: (g: GlyphSnapshot) => void): PointId[] {
  const r = executeCommand(json); // JSON parse + validate
  emit(r.snapshot);
  return r.affectedPointIds;
}
```

Collapse EditingManager's one-liner methods onto FontEngine. Kill
InfoManager/IOManager/FontManager — use `Pick<FontEngine, ...>` types for
access control. The call chain becomes:

```
Tool → editor.removePoints(ids) → fontEngine.removePoints(ids) → raw
```

Commands change from `ctx.fontEngine.editing.removePoints(ids)` to
`ctx.engine.removePoints(ids)`.

### What blocks this today

- Commands depend on `CommandFontEngine.editing: CommandEditingAPI` — a
  `Pick<EditingManager, ...>` type with 17 method names. Changing this
  touches every command class.
- The GPU branch adds more methods to EditingManager (`syncMoveNodes`,
  `prepareNodeTransform`, etc.), deepening the dependency.
- MockFontEngine implements `FontEngineAPI` (the NAPI contract), not
  `EditingManager`. Flattening would change what interface the mock targets.
- Tests use `createMockEditing()` which returns `vi.fn()` stubs matching
  `CommandEditingAPI`. These would need to match the new surface.

The refactor is viable but should be done as a focused effort, not
mixed into feature work.
