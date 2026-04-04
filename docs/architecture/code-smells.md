# Code Smell Audit — April 2026

Findings from a full-repo scan. Organized by "how much this slows you down,"
not by severity category.

---

## Tier 1: These actively cost you time

### Editor.ts is a 2,102-line god object

**File:** `apps/desktop/src/renderer/src/lib/editor/Editor.ts`

The constructor wires 16 managers and 9 effect subscriptions (lines 205-286).
The class exposes 100+ public methods, most of which delegate to a manager
which delegates to FontEngine which delegates to native NAPI. To understand
what `deleteSelectedPoints()` does, you trace:

```
Editor.deleteSelectedPoints() (line ~1495)
  → this.#fontEngine.editing.removePoints()
    → EditingManager.#dispatch()
      → this.#engine.raw.removePoints()  ← actual NAPI call
```

Four files, zero logic added by the middle two.

**What to do:** Split Editor into:

- `EditorCanvas` — canvas lifecycle, viewport, rendering coordination
- `EditorState` — signal wiring, effect subscriptions, reactive state
- `EditorCommands` — public mutation API (thin, but at least separate from state)

Or: stop treating Editor as the single entry point and let tools call managers
directly.

---

### testing/services.ts is a 1,516-line hand-maintained mirror

**File:** `apps/desktop/src/renderer/src/testing/services.ts`

This file re-implements Editor's entire public surface as `vi.fn()` stubs.
Every time you add or change an Editor method, you must update this file by
hand. It's the #1 reason test maintenance is painful.

**What to do:** Generate the mock from Editor's type signature, or use a
`Proxy`-based auto-mock that returns `vi.fn()` for any method call.

---

### Engine managers that exist only to delegate

| File                             | Lines | Methods | Logic added                                        |
| -------------------------------- | ----- | ------- | -------------------------------------------------- |
| `engine/info.ts`                 | 95    | 12      | None — every method is `return this.#engine.foo()` |
| `engine/session.ts`              | 69    | 5       | One guard (skip re-activation of same glyph)       |
| `engine/io.ts`                   | 23    | 2       | None                                               |
| `editor/managers/FontManager.ts` | 61    | 8       | None — pure pass-through                           |

These add 248 lines and force you to trace through an extra layer for every
operation. `InfoManager` is self-aware about this (line 27: "Thin pass-through
so consumers can depend on `engine.info` without accessing editing").

**What to do:** Merge info/io/session into `FontEngine.ts` directly. The
"capability separation" argument doesn't hold — TypeScript's type system can
enforce access boundaries without wrapper classes. For `FontManager`, either
delete it and use `FontEngine.info` directly, or give it actual
responsibilities (caching, derived computations).

---

## Tier 2: Duplication that will bite you eventually

### `DEFAULT_X_ADVANCE = 600` exists in three places

| Location                                                   | Form                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `crates/shift-core/src/constants.rs:2`                     | `pub const DEFAULT_X_ADVANCE: f64 = 600.0;`          |
| `apps/desktop/src/renderer/src/lib/tools/text/layout.ts:7` | `const NON_SPACING_EDITOR_ADVANCE = 600;`            |
| `apps/desktop/src/renderer/src/lib/editor/Editor.ts:1268`  | `return 600;` (hardcoded in `getVisualGlyphAdvance`) |

The TS copies don't reference the Rust constant. If you change the default
advance in Rust, the text tool and visual advance will silently disagree.

**What to do:** Expose `DEFAULT_X_ADVANCE` from the native module (one new
NAPI getter), import it in TS. Or add it to `packages/types/src/constants.ts`
and enforce it's the single source.

---

### Two `GlyphRef` interfaces with different optionality

```typescript
// apps/desktop/src/shared/bridge/FontEngineAPI.ts:25
export interface GlyphRef {
  glyphName: string;
  unicode?: number | null; // ← optional
}

// apps/desktop/src/renderer/src/lib/tools/text/layout.ts:9
export interface GlyphRef {
  glyphName: string;
  unicode: number | null; // ← required
}
```

These are the same concept but aren't the same type. Text layout code doesn't
import from FontEngineAPI, so they can silently diverge further.

**What to do:** Define `GlyphRef` once in `packages/types/`. Both call sites
import from there.

---

### Duplicate `EPSILON = 1e-10`

```typescript
// packages/geo/src/Vec2.ts:32
const EPSILON = 1e-10;

// packages/rules/src/constraints.ts:4
const EPSILON = 1e-10;
```

Also: `steps.ts:21` uses `SELF_SNAP_EPSILON = 1e-6`, `Curve.ts` uses
`NEWTON_TOLERANCE = 1e-6`, and Rust uses `1e-12` in places. Five different
epsilon values across two languages.

**What to do:** Export `EPSILON` from `packages/geo` and import it in
`packages/rules`. For Rust, keep its own — the languages legitimately need
different precision, but at least TS should be consistent.

---

### Bezier extrema finding implemented in both Rust and TypeScript

| Rust                                                         | TypeScript                                         |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `crates/shift-core/src/curve.rs` — `find_cubic_extrema_1d()` | `packages/geo/src/Curve.ts` — `findCubicExtrema()` |

Both compute cubic curve extrema for bounding boxes and hit testing. Two
independent implementations of the same math.

**What to do:** Long-term, expose curve math from Rust. Short-term, add a
shared test suite (same input/output fixtures) to ensure they agree.

---

## Tier 3: Friction that adds up

### Coordinate transform logic is scattered

Scene-to-glyph and screen-to-scene transforms live in:

- `ViewportManager` — screen ↔ scene
- `Editor.ts:1352-1360` — `sceneToGlyphLocal()` / `glyphLocalToScene()`
- `CanvasCoordinator` — render-time projection

Three places doing matrix math. No single `TransformStack` or similar.

**What to do:** Consolidate into `packages/geo/src/Mat.ts` (already exists)
and use it consistently. The coordinate types in
`apps/desktop/src/renderer/src/types/coordinates.ts` are good — the transforms
that operate on them should live next to them.

---

### `SegmentId` branded type is app-local

**File:** `apps/desktop/src/renderer/src/types/indicator.ts`

`PointId`, `ContourId`, `AnchorId` are in `packages/types/src/ids.ts` (shared).
`SegmentId` is defined locally in the desktop app. If any package needs to
reference segments, it can't.

**What to do:** Move to `packages/types/src/ids.ts`.

---

### Barrel re-exports obscure definitions

Packages like `@shift/validation` and `@shift/glyph-info` have `index.ts`
files that re-export 40+ symbols. Not harmful, but "go to definition" lands
you in the barrel, not the actual source. Standard monorepo friction.

**What to do:** Keep barrels for external consumers, but within the monorepo
prefer direct file imports when practical.

---

## Tier 4: Noted but not urgent

### RenderPointSnapshot / RenderContourSnapshot leak UI concerns into Rust

`crates/shift-core/src/snapshot.rs:93-130` defines rendering-specific snapshot
types (no IDs, display-only) that get `#[ts(export)]`ed. These are used only
for composite overlay rendering. They make the Rust ↔ TS contract wider than
necessary.

Not worth fixing now, but if you ever refactor the snapshot system, consider
keeping render snapshots TS-side only.

---

### Hardcoded `targetX = 300` in Editor.ts

`Editor.ts:2055` — a hardcoded half-advance for centering non-spacing glyphs.
Should derive from the actual advance width or metrics.

---

## Tier 5: Dead code and unused dependencies

### Unused npm dependencies in `apps/desktop/package.json`

- `beautiful-mermaid` — not imported anywhere in desktop app source
- `chroma-js` — not imported anywhere in desktop app source
- `clsx` — not imported in desktop app (only used inside `@shift/ui` where it's its own dep)

Also: root `package.json` has a pnpm override for `beautiful-mermaid` that
serves no purpose if the dep is removed.

### Unused re-export in `@shift/ui`

`packages/ui/src/index.ts:35` exports `Search` from `lucide-react` — never
imported by any consumer.

### `@shift/rules` has zero test coverage

These files have non-trivial logic and no tests:

- `packages/rules/src/actions.ts` — rule application during drags
- `packages/rules/src/matcher.ts` — pattern matching
- `packages/rules/src/parser.ts` — rule parsing
- `packages/rules/src/constraints.ts` — geometric constraint math

This is the constraint system that runs on every pointer-move. Untested vector
math is a real risk.

### Outstanding TODOs

- `packages/glyph-info/src/types.ts:1,20,21,27,29` — 5 TODOs about narrowing
  union types for `GlyphSubCategory`, `GlyphScript`, `CharsetId`, `CharsetSource`
- `apps/desktop/src/renderer/src/context/ThemeContext.tsx:17` — dark theme
  placeholder (`// TODO: Replace with darkTheme when implemented`)

---

## Tier 6: Architectural debt — the mutation layer

> Added April 2026 after tracing the full edit flow end-to-end and reviewing
> the GPU branch (`kostya-gpu-point-handles`).

### EditingManager is boilerplate disguised as architecture

Of EditingManager's 342 lines, ~50 are the real dispatch pattern (`#execute`,
`#dispatch`, `#dispatchVoid`). The remaining ~290 lines are 15+ methods that
each do `this.#dispatchVoid(this.#engine.raw.someCommand(args))` — identical
one-liners with different method names.

The dispatch pattern itself is a free function waiting to be extracted:

```typescript
function dispatchCommand(json: string, emit: EmitGlyph): PointId[] { ... }
```

Methods with real logic (addPoint, pasteContours, applySmartEdits,
setNodePositions, restoreSnapshot) should live on FontEngine. The one-liners
should be replaced by direct `dispatchCommand(raw.foo(), emit)` calls.

**What to do:** Extract dispatch as a utility, collapse one-liner methods
onto FontEngine, delete EditingManager. See `rust-ts-boundary.md` §5 for
the full analysis and what blocks it.

### The preview session pattern is duplicated three times

On the GPU branch, `beginTranslateDrag`, `beginRotateDrag`, and
`beginResizeDrag` each create a `NodePositionPreviewSession` with nearly
identical orchestration:

1. Capture base glyph
2. Prepare native transform (Tier 2)
3. On each frame: build updates from input, call `preview.preview(updates)`
4. On commit: sync to Rust (Tier 2), record undo command, clear prepared transform
5. On cancel: restore base glyph, clear prepared transform

The three methods differ only in how they build updates from user input
(delta vs angle vs scale). The preview/commit/cancel lifecycle, native
transform preparation, and cleanup are copy-pasted.

**What to do:** Extract `#createNodePositionPreviewSession` into a standalone
`PreviewSession` that can be composed with different update-building strategies.
The drag methods become thin: create session + supply an update function.

### MockFontEngine grows with every tier

MockFontEngine is already 499 lines reimplementing the NAPI contract. The GPU
branch adds ~130 more lines for Tier 2 methods (`moveNodesLight`,
`movePointsAndAnchorsLight`, `prepareNodeTransformLight`,
`applyPreparedNodeTransformLight`, `clearPreparedNodeTransformLight`) plus
the affine transform math.

Every new NAPI method requires a parallel mock implementation. The mock has
no tests of its own — it's tested indirectly through the code that uses it.

**What to do:** Consider one of:

- Generate the mock from `FontEngineAPI` types (Proxy-based auto-mock)
- Integration tests against the real native module for critical paths
- Shared test fixtures that validate mock and real engine produce the same
  output for the same inputs

### FontEngineAPI is hand-maintained from napi-rs output

napi-rs already generates `crates/shift-node/index.d.ts` with full type
signatures for all `#[napi]` methods. `FontEngineAPI.ts` is a manually
maintained copy of the same information. Every new Rust command requires
updating both files.

The Tauri ecosystem solved this with tauri-specta (auto-generates typed TS
wrappers from Rust function signatures). We could adapt this by parsing
the napi-rs generated `.d.ts` and emitting `FontEngineAPI` automatically.

**What to do:** Write a codegen script that reads `crates/shift-node/index.d.ts`
and generates `FontEngineAPI.ts`. This eliminates one of the 5 touchpoints
documented in the `/wire-rust` skill.

---

## Quick-win list (do these first)

1. **Unify `GlyphRef`** — 5 minutes, prevents a real bug
2. **Export `EPSILON` from `@shift/geo`** — 5 minutes, import in `@shift/rules`
3. **Extract `DEFAULT_X_ADVANCE` to shared constant** — 15 minutes
4. **Delete `FontManager.ts`** — replace 8 call sites with `fontEngine.info.*`
5. **Delete `engine/io.ts`** — 2 methods, inline into FontEngine
6. **Remove `beautiful-mermaid` and `chroma-js`** from `apps/desktop/package.json`
7. **Add basic tests for `@shift/rules`** — at minimum, snapshot tests for constraint outputs
