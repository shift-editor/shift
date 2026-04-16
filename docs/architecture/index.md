# Documentation Routing Index

Central routing table for Shift's distributed documentation. Before creating new docs or exploring unfamiliar subsystems, consult this index to find the canonical deep documentation.

## How to use this index

1. Identify the path you are working in
2. Find the matching pattern below
3. Read the linked DOCS.md before making changes
4. For cross-cutting concerns (type boundaries, desktop-Rust bridge), see the cross-cutting docs section

## Routing Table

### Rust crates

| Path pattern | Canonical doc | Purpose |
|---|---|---|
| `crates/shift-core/**` | [`crates/shift-core/docs/DOCS.md`](../../crates/shift-core/docs/DOCS.md) | Core data structures and editing logic (Font, Glyph, Contour, Point, EditSession) |
| `crates/shift-backends/**` | [`crates/shift-backends/docs/DOCS.md`](../../crates/shift-backends/docs/DOCS.md) | Font format backends for reading/writing various font formats |
| `crates/shift-ir/**` | [`crates/shift-ir/docs/DOCS.md`](../../crates/shift-ir/docs/DOCS.md) | Format-agnostic intermediate representation for the font model |
| `crates/shift-node/**` | [`crates/shift-node/docs/DOCS.md`](../../crates/shift-node/docs/DOCS.md) | NAPI bindings exposing Rust to Node.js/Electron |

### Desktop app — Electron shell

| Path pattern | Canonical doc | Purpose |
|---|---|---|
| `apps/desktop/src/main/**` | [`apps/desktop/src/main/docs/DOCS.md`](../../apps/desktop/src/main/docs/DOCS.md) | Electron main process: lifecycle, windows, menus, document state |
| `apps/desktop/src/preload/**` | [`apps/desktop/src/preload/docs/DOCS.md`](../../apps/desktop/src/preload/docs/DOCS.md) | Preload script bridging native Rust FontEngine to renderer |
| `apps/desktop/src/shared/bridge/**` | [`apps/desktop/src/shared/bridge/docs/DOCS.md`](../../apps/desktop/src/shared/bridge/docs/DOCS.md) | Type-safe preload bridge system (FontEngineAPI contract) |

### Desktop app — Renderer

| Path pattern | Canonical doc | Purpose |
|---|---|---|
| `apps/desktop/src/renderer/src/bridge/**` | [`apps/desktop/src/renderer/src/bridge/docs/DOCS.md`](../../apps/desktop/src/renderer/src/bridge/docs/DOCS.md) | NativeBridge: reactive wrapper over NAPI, owns Glyph lifecycle |
| `apps/desktop/src/renderer/src/lib/editor/**` | [`apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md) | Canvas-based glyph editor, viewport transforms, selection |
| `apps/desktop/src/renderer/src/lib/tools/**` | [`apps/desktop/src/renderer/src/lib/tools/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/tools/docs/DOCS.md) | State machine-based tool system (BaseTool, behaviors, actions) |
| `apps/desktop/src/renderer/src/lib/graphics/**` | [`apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md) | Rendering abstraction with Canvas 2D backend and path caching |
| `apps/desktop/src/renderer/src/lib/transform/**` | [`apps/desktop/src/renderer/src/lib/transform/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/transform/docs/DOCS.md) | Geometry transforms: rotate, scale, reflect selected points |
| `apps/desktop/src/renderer/src/lib/commands/**` | [`apps/desktop/src/renderer/src/lib/commands/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/commands/docs/DOCS.md) | Command pattern with undo/redo for all editing operations |
| `apps/desktop/src/renderer/src/lib/reactive/**` | [`apps/desktop/src/renderer/src/lib/reactive/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/reactive/docs/DOCS.md) | Fine-grained reactivity: dependency tracking and efficient updates |

### Packages

| Path pattern | Canonical doc | When to read |
|---|---|---|
| `packages/types/**` | See `Claude.md` "Generated and domain types" section | Changing type definitions or adding new Rust-generated types |
| `packages/geo/**` | — | Geometry utilities (Vec2, Curve, Polygon) |
| `packages/font/**` | — | Glyph-domain geometry (contour traversal, segment parsing, bounds) |
| `packages/ui/**` | See `Claude.md` "Base UI Components" section | Creating or modifying UI components |

## API Boundaries

These modules have stricter change rules. Changes affect multiple layers and require `pnpm typecheck` to validate.

- **`FontEngineAPI`** (`apps/desktop/src/shared/bridge/FontEngineAPI.ts`) — the single type definition bridging preload and renderer. Changes here affect both sides of the Electron boundary.
- **`@shift/types`** (`packages/types/`) — generated types from Rust are the source of truth. Domain types must derive from generated types, never re-declare structure.
- **`NativeBridge`** (`apps/desktop/src/renderer/src/bridge/`) — the single class wrapping NAPI bindings. All Rust access goes through NativeBridge.

## Validation

Run `python scripts/context-drift-check.py` from the repo root to check for broken links, stale docs, and missing documentation.
