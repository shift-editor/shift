# Shift Editor - Development Guide

## General Guidelines

- Prefer switch statements over long if-else chains when branching on the same value.
- Prefer early returns over nested if-else blocks. Return early for guard clauses to keep the main logic at the top indentation level. In React components, guard on null data at the top (`if (!glyph) return null;`) instead of scattering `glyph?.foo ?? fallback` throughout the JSX.
- Prefer `async`/`await` with `try`/`catch` for asynchronous control flow.
- Avoid `.then(...)` / `.catch(...)` chains in application code when the same flow can be written clearly with `await`.
- Avoid `void promise.catch(...)` in React event handlers and normal command handlers. Use an `async` function with `try`/`catch` instead.
- Use `void promise.catch(...)` only for genuinely fire-and-forget boundaries that cannot be awaited by the caller, such as Electron menu callbacks. Keep those cases local and log or surface the failure.
- Name intermediate values. Pull non-trivial expressions (sets, filtered lists, compound conditions) into named `const`s or a named function with early returns instead of nesting them inside ternaries, arguments, or JSX. Nested ternaries are a lint error.
- Extract repeated logic. When the same condition or mapping appears at several call sites, extract one helper next to the code it belongs to (for example `listSelectionMode` in `hooks/useListSelection.ts`, `nudgeMagnitude` in `types/nudge.ts`) and use it everywhere.
- Avoid async IIFEs assigned into state, for example `state = (async () => { ... })().catch(...)`. Extract a named helper so the shared-state/memoization code and the async work are readable separately.
- Derive lookups over reactive state with `computed` (or hold an immutable collection in a signal and replace it). Never hand-maintain a Map/Set that mirrors a signal: a plain collection cannot notify, so readers in `computed`/effects go stale. `shift/no-mutable-collection-field` enforces this; annotate a genuinely non-reactive field with `// non-reactive: <reason>`.
- Do not prefix commit messages or pull request titles with `[codex]`.

## Agent Skills

- `.agents/skills/` is the canonical source for repository skills. Pi discovers this standard location automatically.
- Load the matching skill before acting: `commit` for commits, `pr` for pull requests, `issue` for issues, `writing-tests` for test changes or reviews, `writing-e2e-tests` for desktop Playwright specs, fixtures, and visual goldens, `ui` for interface and styling work, `signals` for reactive code (`signal`, `computed`, `effect`, model and render state), `jsdoc` for JSDoc, `typescript` for TypeScript domain types, lookups, collections and extensible kinds, `rust` for Rust code (error handling, lookups, checked arithmetic), and `rustdoc` for Rust documentation.
- `.claude/skills/` and `.codex/skills/` are generated client adapters. Never edit shared skills there directly.
- After changing a canonical skill, run `pnpm agent-skills:sync`. CI runs `pnpm agent-skills:check` to prevent adapter drift.

## Naming

- **Domain types are plain nouns.** `Glyph`, `Contour`, `Point`, `Anchor` — not `Glyph`, `GlyphInfo`, `GlyphState`, `GlyphRenderData`. If you need a modifier, it should describe the _kind_ of thing (`EditableGlyph`, `RenderContour`), not append generic suffixes.
- **Avoid `-Data`, `-Info`, `-State` suffixes** on types unless it genuinely represents transient mutable state (e.g. `TextRunRenderState` for a signal value consumed by a render pass). If the type represents a domain concept, name it after the concept.
- **Signals are named `*Cell`; values use the plain noun.** A `Signal<Glyph | null>` is `glyphCell`, and the unwrapped value is `glyph`. Do not introduce new dollar-prefixed signal names; those are legacy style.
- **Use `track(cell)` for invalidation-only subscriptions.** Inside `computed`/`effect`, use `track(fooCell)` when the code needs to rerun on `fooCell` changes but does not use the value. Use `const foo = fooCell.value` when the value is actually read.

## Roadmap

When completing a feature, check ROADMAP.md and check any box if we have completed it in the new feature. Always add tests to verify behaviour.

## Testing

Tests use `TestEditor` from `@/testing/TestEditor` (real Editor + real NAPI). Assert on state, not mock calls. See `/writing-tests` skill for canonical rules, templates, banned patterns, and the fake-test checklist — trigger it any time you add, rewrite, or review a `.test.ts` file.

Never delete tests solely because their named implementation was removed or replaced. Before deleting or materially reducing tests, map every removed test to the behavioral invariant it protects and to the surviving or replacement test that protects it. Move tests to the new behavioral owner before deleting the old file. If an invariant is obsolete, identify the intentionally removed product behavior.

## Frontend

### Base UI Components

All UI components must wrap [Base UI](https://base-ui.com/react/components) primitives:

- ALWAYS check if a Base UI component exists before creating a custom implementation
- Wrapper components live in `packages/ui/src/components/{componentName}/`
- Import Base UI as `import { Component as BaseComponent } from "@base-ui/react/component"`
- Export a wrapped version that applies project styling and extends the Base UI props
- Use the same name as Base UI (e.g., `Separator`, `Input`, `Tooltip`)

Example wrapper structure:

```tsx
import { Separator as BaseSeparator } from "@base-ui/react/separator";

export interface SeparatorProps extends React.ComponentProps<typeof BaseSeparator> {}

// React 19 passes `ref` as a prop, so it reaches the primitive through `...props`.
export function Separator({ className, ...props }: SeparatorProps) {
  return <BaseSeparator className={cn("project-styles", className)} {...props} />;
}
```

## Package Manager

This project uses **pnpm** (v11) as its package manager.

## Development Environment

- Run repository commands inside the Nix dev shell defined by `flake.nix`.
- When `IN_NIX_SHELL` is unset, use `nix develop --command <command>` rather than relying on machine-global Node, pnpm, Rust, Cargo, or native dependencies.
- Fresh and remote worktrees must not assume direnv has allowed `.envrc`; either launch the agent with `nix develop --command pi` or prefix its repository commands with `nix develop --command`.
- Do not create Corepack wrappers or install fallback toolchains to work around a missing dev-shell command.

## Available Commands

### Development

- `pnpm dev` - Start Electron/Vite with a debug Rust addon
- `pnpm dev:release` - Start Electron/Vite with a release Rust addon for representative performance
- `pnpm dev:watch` - Start with automatic debug Rust rebuilds
- `pnpm dev:watch:release` - Start with automatic release Rust rebuilds

### Code Quality

- `pnpm format` - Format `apps/` and `packages/` with Oxfmt
- `pnpm format:check` - Check Oxfmt formatting without modifying files
- `pnpm format:files <paths...>` - Format only the specified files with Oxfmt
- `pnpm lint` - Lint code with Oxlint (auto-fix)
- `pnpm lint:check` - Lint code without auto-fix
- Every package's `.oxlintrc.json` extends the root `.oxlintrc.json`, which loads the `shift` plugin and the shared rules; a package config adds only its own rules
- `pnpm typecheck` - Type check with tsgo
- `cargo fmt` - Format Rust code (run after any Rust changes)
- `cargo clippy` - Lint Rust code (run after any Rust changes)
- `cargo deny check` - Check Rust dependency licenses, advisories and sources against `deny.toml` (run after changing dependencies)
- `cargo machete` - Find Rust dependencies no code uses
- `pnpm scan:rust [--since <rev>]` - Report Rust structure worth a look (free functions that read as methods, method names several types share, long chains); report-only, never fails
- `pnpm scan:ts [--since <rev>]` - Report TypeScript that computes what a same-named Rust function does, free functions that read as methods, and wrapper-named classes; report-only

Use repository scripts when a matching command exists; they encode the intended tool, scope, and version. Run all TypeScript/JavaScript formatting through `pnpm format`, `pnpm format:check`, or `pnpm format:files`; never invoke Oxfmt directly and never use Prettier in this repository.

### Testing

- `pnpm test` - Run all tests once through Turbo
- `pnpm test:desktop <test-file>` - Run focused desktop tests through Turbo
- `pnpm test:native` - Run native bridge tests through Turbo
- `pnpm test:watch` - Run tests in watch mode through Turbo

Use these root commands instead of invoking a package's Vitest script directly. The Turbo graph builds the NAPI bridge before desktop and native tests, preventing stale or partially written native addons from crashing Vitest workers.

### Building

- `pnpm build:native` - Build Rust native modules (the NAPI addon and the WebAssembly module)
- `pnpm build:native:debug` - Build native modules in debug mode
- `pnpm build:wasm` - Build the editor's WebAssembly module (`crates/shift-wasm`) into `packages/wasm/src/generated/` (gitignored). `build:native` and the turbo test and desktop build tasks build it first, and typecheck builds only its declarations (`@shift/wasm#types`); see `crates/shift-wasm/docs/DOCS.md`
- `pnpm package` - Package the application
- `pnpm make` - Build and create distribution

### Generated Code

- `pnpm generate:bridge-types` - Regenerate `@shift/types` bridge DTOs from `shift-bridge` declarations
- `pnpm generate:from-rust` - Regenerate Rust-derived layouts in `packages/types/src/layout/` and Rust-generated fixtures

### Glyph Info

- `pnpm generate:glyph-info` - Generate glyph data, decomposition, charsets, and FTS5 search index
- `pnpm glyph-info:repl` - Start interactive REPL with GlyphInfo pre-loaded

### Maintenance

- `pnpm clean` - Clean build artifacts and node_modules
- `pnpm check-deps` - Check for unused dependencies

## Project Structure

- `apps/desktop/src/` - Electron app (main, preload, renderer, shared)
- `crates/` - Rust workspace (shift-font, shift-backends, shift-bridge, shift-store)
- `packages/` - TypeScript packages (types, geo, font, ui)

## Code Organization Rules

### Package vs App Code

- Geometry utilities (Vec2, Curve, Polygon) → import from `@shift/geo`
- Glyph-domain geometry (contour traversal, segment parsing, tight/x bounds) → import from `@shift/glyph-state`
- Core types (Point2D, Rect2D, PointId, ContourId) → import from `@shift/types`
- NEVER duplicate package code in app layer
- If you need functionality from a package, import it; don't copy it
- Do not synthesize fake point IDs for geometry-only operations
- Canonical glyph geometry APIs: `segmentContour` (segments and bounds from shift-font through `@shift/wasm`), `Contour.bounds`, `GlyphGeometry.bounds`

### Import Conventions

- `@shift/*` for imports from packages (external-facing shared code)
- `@/*` for app-wide imports (from renderer/src root)
- Relative imports (`./`, `../`) only within the same module directory
- Never mix import styles for the same module
- **Never use inline type imports** such as `import("@shift/types").PointId`, `import("@/types/hitResult").ContourEndpointHit`, or `import("../core").ToolEvent`. Always use top-level imports: `import type { PointId } from "@shift/types"`, `import type { ContourEndpointHit } from "@/types/hitResult"`, or `import type { ToolEvent } from "../core"`.

### Type Definitions

- Domain types belong in `/types/{domain}.ts`, not in implementation files
- NEVER define types (interfaces, type aliases, enums) directly in classes or service files
- Types should be imported from dedicated type files
- NEVER write derived utility types such as `Pick<Contour, "points" | "closed">` or `Omit<...>` inline in a function signature or body. Give the contract its own named type declaration in the appropriate domain type file and import it.
- Re-export types from their domain's index.ts for public API
- NEVER re-declare types that exist in `@shift/types` (generated from Rust). Import from `@shift/types`; for derived views (e.g. readonly, nested) use the domain pattern in `packages/types/src/domain.ts`

### Generated and domain types

- **Generated types** live ONLY in `packages/types/src/bridge/generated.ts`, generated from shift-bridge's NAPI declarations. Run `pnpm generate:bridge-types` to regenerate. They are the single source of truth for shapes and field names (e.g. `familyName`, `versionMajor`, not `family` or `version`).
- **Generated layouts** (glyph value, source metric, and Slug atlas offsets and strides) live in `packages/types/src/layout/` and are exported from `@shift/types`. Rust tests in `shift-font` and `shift-slug` render them and fail when the checked-in copy is stale; run `pnpm generate:from-rust` after changing a Rust layout. Never hard-code these offsets in TypeScript.
- **WebAssembly call layouts** are declared in `crates/shift-wasm` and generated into `packages/editor/src/lib/wasm/generated/layouts.ts` by the same command. Never hand-pack a `Float64Array` for a `@shift/wasm` call.
- **Domain types** derived from generated shapes (definitions before an id is assigned, resolved metrics) live in `packages/types/src/domain.ts` and MUST derive from generated types (`Pick`, `Omit`, composition): same field names, no re-declaration of structure. The glyph model classes (`Point`, `Contour`, `Segment`, `Component`) live in `@shift/glyph-state`, and `Glyph` and `Font` in `packages/editor/src/lib/model/`.
- **App layer**: NEVER re-declare types that exist in `@shift/types`. Import `FontMetadata`, `FontMetrics`, snapshot types, etc. from `@shift/types`. If you need a narrowed or immutable view, define it in `packages/types` (e.g. domain.ts) as a type derived from the generated type, not as a new interface in the app.
- Bridge and native layer are typed with `@shift/types`; engine and UI use those types and the same field names (e.g. `familyName` in the UI, not `family`).

### File Size Guidelines

- Single classes should not exceed 500 lines
- If a file grows beyond 300 lines, evaluate splitting by responsibility
- Prefer composition over monolithic classes

## Architectural Constraints

- **Rust owns every answer; TypeScript asks.** shift-font and its libraries (fontc, fea-rs, fontdrasil, harfrust, line breaking) compute anything another consumer could need too (the CLI, export, the window's engine, the utility process, the SDK, agents), once, and every consumer calls it; never keep a second TypeScript copy in sync. The TypeScript model looks things up (by id or name, counts, stored order), holds reactivity and delegates the rest to the engine; readers translate; tools and UI ask the model.
- **NEVER construct variation models in TypeScript.** Rust/Fontdrasil exclusively owns sample ordering, support construction, master influence, and delta decomposition. TypeScript evaluates transported compiled bases only through `@shift/wasm`, which runs shift-font's evaluators.
- **NEVER port a Rust rule to TypeScript.** When the editor needs a shift-font rule synchronously, export it from `crates/shift-wasm` and call it, rather than keeping a copy checked by an oracle. Where a rule must stay in TypeScript (per-frame geometry, kerning precedence over the pending-edit overlay), test it against the Rust directly through the test-only `@shift/wasm/reference` module, never against a fixture Rust writes. Before writing TypeScript that mirrors shift-font geometry or variation logic, read "Choosing a route" in `crates/shift-wasm/docs/DOCS.md`.
- **Raw axis-mapping points stop at authoring boundaries.** `AxisMapping.points` may be read by Rust compilation and TypeScript mapping-authoring UI/model code only. Glyph, interpolation, source matching, metrics, editability, and atlas-weight evaluation must consume `AxisMappingBasis`, never `AxisMapping` or `AxisMappingPoint`.
- **Compiled variation math carries no synthetic domain identity.** Transport `VariationBasis`, `VariationDelta`, and `GlyphVariation` as regions and numeric vectors. Never adapt imported deltas into `GlyphInterpolation`, invent `SourceId` values for them, or add an identity coefficient matrix.
- **NEVER create Manager, Store, or Cache wrapper classes.** NativeBridge is the single interface to Rust. Do not wrap it in FooManager, FooStore, or FooCache. If you need derived data, compute it at the call site — NAPI calls are ~50μs.
- **NEVER create CONTEXT.md files.** These are agent-generated dumps that go stale. Use `docs/architecture/` for architecture docs.

## Anti-Slop Rules

Rules enforced by `scripts/oxlint/shift-plugin.mjs` are omitted here — the linter catches them. The rules below are conventions not covered by lint:

- **Use Point2D in function signatures.** Never create `(x, y)` / `(Point2D)` overloads with `typeof` resolution code.
- **Blank lines between logical blocks.** Separate guard clauses, branches, and return statements with blank lines.
- **Do not add methods to Editor without justification.** Editor.ts is a facade with 150+ delegation methods. Ask: does it add logic? Can it be a pure function? Does it belong on NativeBridge?

## GlyphDraft — Immer-style two-tier mutations

`editor.createDraft()` returns a `GlyphDraft` for drag operations (translate, rotate, resize, bend). The draft separates JS preview (every frame) from Rust persistence (once at end):

- **`setPositions(updates)`** — calls `glyph.apply()` directly. JS-only, no NAPI, no Rust. Fires internal Glyph signals which trigger render effects.
- **`finish(label)`** — syncs final state to Rust via `restoreSnapshot` once, records undo.
- **`discard()`** — restores JS model from base snapshot. Rust was never modified.

**NEVER call `bridge.setNodePositions()` inside the draft hot path.** That sends N individual NAPI struct marshals to Rust per frame. For glyphs with thousands of points this causes ~450ms frames + GC pressure. The draft exists specifically to avoid this.

**Render effects track `glyph.contours` and `glyph.anchors`**, not a bridge glyph identity cell. Bridge glyph identity signals are for loaded/unloaded identity changes. Glyph data changes propagate through the Glyph model's internal signals. `#patchPositions` fires the contour cell with a new array reference so glyph-level effects see the change.

## Documentation Routing

Before creating new documentation or exploring unfamiliar subsystems, consult `docs/architecture/index.md`. It maps every repo area to its canonical `DOCS.md` and lists API boundaries. Use `/docs` to update module documentation following the standard format.

Run `python3 scripts/context-drift-check.py` to validate doc freshness and link integrity.

## Architecture References

- **Documentation routing & API boundaries:** Read `docs/architecture/index.md`
- **Signal patterns & Editor conventions:** Read `lib/editor/Editor.ts` header comments
- **Tool structure & behavior system:** Read `lib/tools/core/BaseTool.ts`
- **Command organization:** Read `lib/commands/core/Command.ts`
