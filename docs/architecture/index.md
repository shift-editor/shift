# Documentation Routing Index

Central routing table for Shift's distributed documentation. Before creating new docs or exploring unfamiliar subsystems, consult this index to find the canonical deep documentation.

## How to use this index

1. Identify the path you are working in
2. Find the matching pattern below
3. Read the linked DOCS.md before making changes
4. For cross-cutting concerns (type boundaries, desktop-Rust bridge), see the cross-cutting docs section

## Routing Table

### Rust crates

| Path pattern                | Canonical doc                                                                      | Purpose                                                       |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `crates/shift-backends/**`  | [`crates/shift-backends/docs/DOCS.md`](../../crates/shift-backends/docs/DOCS.md)   | Font format backends for reading/writing various font formats |
| `crates/shift-font/**`      | [`crates/shift-font/docs/DOCS.md`](../../crates/shift-font/docs/DOCS.md)           | First-class Rust font object model and editing behavior       |
| `crates/shift-source/**`    | [`crates/shift-source/docs/DOCS.md`](../../crates/shift-source/docs/DOCS.md)       | User-authored `.shift` source package layout                  |
| `crates/shift-workspace/**` | [`crates/shift-workspace/docs/DOCS.md`](../../crates/shift-workspace/docs/DOCS.md) | Open font workspace runtime over source, store, and font      |
| `crates/shift-bridge/**`    | [`crates/shift-bridge/docs/DOCS.md`](../../crates/shift-bridge/docs/DOCS.md)       | NAPI bridge exposing Rust to Node.js/Electron                 |

### Desktop app — Electron shell

| Path pattern                        | Canonical doc                                                                                      | Purpose                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/desktop/src/main/**`          | [`apps/desktop/src/main/docs/DOCS.md`](../../apps/desktop/src/main/docs/DOCS.md)                   | Electron main process: lifecycle, windows, menus, document state |
| `apps/desktop/src/preload/**`       | [`apps/desktop/src/preload/docs/DOCS.md`](../../apps/desktop/src/preload/docs/DOCS.md)             | Preload script bridging native Rust FontEngine to renderer       |
| `apps/desktop/src/shared/bridge/**` | [`apps/desktop/src/shared/bridge/docs/DOCS.md`](../../apps/desktop/src/shared/bridge/docs/DOCS.md) | Type-safe preload bridge system (FontEngineAPI contract)         |

### Desktop app — Renderer

| Path pattern                                     | Canonical doc                                                                                                                | Purpose                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/desktop/src/renderer/src/bridge/**`        | [`apps/desktop/src/renderer/src/bridge/docs/DOCS.md`](../../apps/desktop/src/renderer/src/bridge/docs/DOCS.md)               | NativeBridge: reactive wrapper over NAPI, owns Glyph lifecycle     |
| `apps/desktop/src/renderer/src/lib/editor/**`    | [`apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md)       | Canvas-based glyph editor, viewport transforms, selection          |
| `apps/desktop/src/renderer/src/lib/tools/**`     | [`apps/desktop/src/renderer/src/lib/tools/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/tools/docs/DOCS.md)         | State machine-based tool system (BaseTool, behaviors, actions)     |
| `apps/desktop/src/renderer/src/lib/graphics/**`  | [`apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md)   | Rendering abstraction with Canvas 2D backend and path caching      |
| `apps/desktop/src/renderer/src/lib/transform/**` | [`apps/desktop/src/renderer/src/lib/transform/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/transform/docs/DOCS.md) | Geometry transforms: rotate, scale, reflect selected points        |
| `apps/desktop/src/renderer/src/lib/signals/**`   | [`apps/desktop/src/renderer/src/lib/signals/docs/DOCS.md`](../../apps/desktop/src/renderer/src/lib/signals/docs/DOCS.md)     | Fine-grained reactivity: dependency tracking and efficient updates |

### Packages

| Path pattern              | Canonical doc                                                                  | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/types/**`       | [`packages/types/docs/DOCS.md`](../../packages/types/docs/DOCS.md)             | Branded IDs, bridge DTO facade, and legacy editor migration types  |
| `packages/geo/**`         | [`packages/geo/docs/DOCS.md`](../../packages/geo/docs/DOCS.md)                 | Geometry utilities (Vec2, Curve, Polygon, Mat)                     |
| `packages/glyph-state/**` | [`packages/glyph-state/docs/DOCS.md`](../../packages/glyph-state/docs/DOCS.md) | Glyph-domain geometry (contour traversal, segment parsing, bounds) |
| `packages/ui/**`          | [`packages/ui/docs/DOCS.md`](../../packages/ui/docs/DOCS.md)                   | UI component library wrapping Base UI primitives                   |
| `packages/validation/**`  | [`packages/validation/docs/DOCS.md`](../../packages/validation/docs/DOCS.md)   | Point sequence validation and persistence schemas                  |
| `packages/rules/**`       | [`packages/rules/docs/DOCS.md`](../../packages/rules/docs/DOCS.md)             | Point editing rules engine for geometric constraints               |

## API Boundaries

These modules have stricter change rules. Changes affect multiple layers and require `pnpm typecheck` to validate.

- **`FontEngineAPI`** (`apps/desktop/src/shared/bridge/FontEngineAPI.ts`) — the single type definition bridging preload and renderer. Changes here affect both sides of the Electron boundary.
- **`@shift/types/bridge`** (`packages/types/src/bridge/`) — generated bridge DTO facade sourced from `crates/shift-bridge/index.d.ts`.
- **`NativeBridge`** (`apps/desktop/src/renderer/src/bridge/`) — the single class wrapping NAPI bindings. All Rust access goes through NativeBridge.

## Validation

Run `python scripts/context-drift-check.py` from the repo root to check for broken links, stale docs, and missing documentation.
