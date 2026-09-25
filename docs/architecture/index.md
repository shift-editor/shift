# Documentation Routing Index

Central routing table for Shift's distributed documentation. Before creating new docs or exploring unfamiliar subsystems, consult this index to find the canonical deep documentation.

## How to use this index

1. Identify the path you are working in
2. Find the matching pattern below
3. Read the linked DOCS.md before making changes
4. For cross-cutting concerns (type boundaries, desktop-Rust bridge), see the cross-cutting docs section

## Routing Table

### Rust crates

| Path pattern                | Canonical doc                                                                      | Purpose                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `crates/shift-backends/**`  | [`crates/shift-backends/docs/DOCS.md`](../../crates/shift-backends/docs/DOCS.md)   | Font format backends for reading/writing various font formats                               |
| `crates/shift-font/**`      | [`crates/shift-font/docs/DOCS.md`](../../crates/shift-font/docs/DOCS.md)           | First-class Rust font object model and editing behavior                                     |
| `crates/shift-slug/**`      | [`crates/shift-slug/docs/DOCS.md`](../../crates/shift-slug/docs/DOCS.md)           | GPU-independent Slug curves, retained compilation, and packing                              |
| `crates/shift-store/**`     | [`crates/shift-store/README.md`](../../crates/shift-store/README.md)               | Canonical SQLite `.shift`, sparse recovery overlays, compressed layer payloads, and indexes |
| `crates/shift-workspace/**` | [`crates/shift-workspace/docs/DOCS.md`](../../crates/shift-workspace/docs/DOCS.md) | Open font workspace runtime over source, store, and font                                    |
| `crates/shift-bridge/**`    | [`crates/shift-bridge/docs/DOCS.md`](../../crates/shift-bridge/docs/DOCS.md)       | NAPI bridge exposing Rust to Node.js/Electron                                               |

### Desktop app — Electron shell

| Path pattern                  | Canonical doc                                                                          | Purpose                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/desktop/src/main/**`    | [`apps/desktop/src/main/docs/DOCS.md`](../../apps/desktop/src/main/docs/DOCS.md)       | Electron main process: lifecycle, windows, menus, document state |
| `apps/desktop/src/preload/**` | [`apps/desktop/src/preload/docs/DOCS.md`](../../apps/desktop/src/preload/docs/DOCS.md) | Typed app-shell API and session-port relay                       |
| `apps/desktop/e2e/**`         | [`apps/desktop/e2e/README.md`](../../apps/desktop/e2e/README.md)                       | Playwright visual, GPU correctness, and performance suites       |

### Desktop app — Renderer

| Path pattern                                     | Purpose                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/components/**`    | React application shell and editor mounting surfaces                                      |
| `apps/desktop/src/renderer/src/lib/workspace/**` | Workspace transport, durable edit queue, and native-backed reads                          |
| `apps/desktop/src/renderer/src/lib/graphics/**`  | [Workspace atlas adapters](../../apps/desktop/src/renderer/src/lib/graphics/docs/DOCS.md) |
| `apps/desktop/src/renderer/src/lib/themes/**`    | [Application color themes](../../apps/desktop/src/renderer/src/lib/themes/docs/DOCS.md)   |
| `apps/desktop/src/renderer/src/workspace/**`     | Desktop session composition and Electron host wiring                                      |

### Packages

| Path pattern                           | Canonical doc                                                                    | Purpose                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/editor/src/lib/editor/**`    | [`editor/docs/DOCS.md`](../../packages/editor/src/lib/editor/docs/DOCS.md)       | Editor facade, viewport, selection, and rendering                  |
| `packages/editor/src/lib/model/**`     | [`model/docs/DOCS.md`](../../packages/editor/src/lib/model/docs/DOCS.md)         | Reactive font, glyph layers, interpolation, and editing            |
| `packages/editor/src/lib/tools/**`     | [`tools/docs/DOCS.md`](../../packages/editor/src/lib/tools/docs/DOCS.md)         | Tool state machines and interaction behaviors                      |
| `packages/editor/src/lib/signals/**`   | [`signals/docs/DOCS.md`](../../packages/editor/src/lib/signals/docs/DOCS.md)     | Fine-grained reactive graph                                        |
| `packages/editor/src/lib/text/**`      | [`text/docs/DOCS.md`](../../packages/editor/src/lib/text/docs/DOCS.md)           | Text records, interaction, and layout                              |
| `packages/editor/src/lib/transform/**` | [`transform/docs/DOCS.md`](../../packages/editor/src/lib/transform/docs/DOCS.md) | Geometry transforms and alignment                                  |
| `packages/types/**`                    | [`packages/types/docs/DOCS.md`](../../packages/types/docs/DOCS.md)               | Branded IDs, generated bridge DTO facade, and shared domain types  |
| `packages/geo/**`                      | [`packages/geo/docs/DOCS.md`](../../packages/geo/docs/DOCS.md)                   | Geometry utilities (Vec2, Curve, Polygon, Mat)                     |
| `packages/glyph-state/**`              | [`packages/glyph-state/docs/DOCS.md`](../../packages/glyph-state/docs/DOCS.md)   | Glyph-domain geometry (contour traversal, segment parsing, bounds) |
| `packages/ui/**`                       | [`packages/ui/docs/DOCS.md`](../../packages/ui/docs/DOCS.md)                     | UI component library wrapping Base UI primitives                   |
| `packages/validation/**`               | [`packages/validation/docs/DOCS.md`](../../packages/validation/docs/DOCS.md)     | Point sequence validation and persistence schemas                  |
| `packages/rules/**`                    | [`packages/rules/docs/DOCS.md`](../../packages/rules/docs/DOCS.md)               | Point editing rules engine for geometric constraints               |

## Cross-cutting operations

| Concern                   | Canonical doc                                                    | Purpose                                                      |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Canonical `.shift` format | [`ADR 0001`](decisions/0001-canonical-sqlite-shift-documents.md) | SQLite document, identity, Save, and recovery decision       |
| Desktop releases          | [`docs/releases.md`](../releases.md)                             | Release states, versioning, workflows, signing, and rollback |

## API Boundaries

These modules have stricter change rules. Changes affect multiple layers and require `pnpm typecheck` to validate.

- **`@shift/editor`** (`packages/editor/`) — browser-safe font model, editor, tools, and rendering runtime. It must not import Electron, native bridge modules, desktop host modules, persistence adapters, or its own package name. Internal modules use relative imports; consumers use the explicit root, clipboard, model, rendering, signals, testing, text, tools, transform, types, and variation exports.
- **`@shift/types/bridge`** (`packages/types/src/bridge/`) — generated bridge DTO facade sourced from `crates/shift-bridge/index.d.ts`.
- **`shared/workspace/protocol.ts`** — typed shell and renderer/utility session lanes. Changes affect main, utility, and renderer processes.
- **`WorkspaceHost`** (`apps/desktop/src/utility/workspace/WorkspaceHost.ts`) — utility-process owner of the native bridge.
- **`FontSessionClient`** (`apps/desktop/src/renderer/src/lib/workspace/FontSessionClient.ts`) — renderer owner of the typed session connection.
- **Browser editor check** (`apps/desktop/vite.browser.config.ts`) — build-only canary for `@shift/editor` plus the current React canvas shell. It is not a published embedding API.

## Validation

Run `pnpm check:browser` to produce a minified/gzip bundle report and reject Electron, Node, native bridge, desktop host, and complete glyph-info resource modules from the browser editor graph.

Run `python scripts/context-drift-check.py` from the repo root to check for broken links, stale docs, and missing documentation.
