# Shift Editor - Development Guide

## General Guidelines

- Prefer switch statements over long if-else chains when branching on the same value.
- Prefer early returns over nested if-else blocks. Return early for guard clauses to keep the main logic at the top indentation level. In React components, guard on null data at the top (`if (!glyph) return null;`) instead of scattering `glyph?.foo ?? fallback` throughout the JSX.

## Naming

- **Domain types are plain nouns.** `Glyph`, `Contour`, `Point`, `Anchor` — not `GlyphData`, `GlyphInfo`, `GlyphState`, `GlyphRenderData`. If you need a modifier, it should describe the _kind_ of thing (`EditableGlyph`, `RenderContour`), not append generic suffixes.
- **Avoid `-Data`, `-Info`, `-State` suffixes** on types unless it genuinely represents transient mutable state (e.g. `TextRunRenderState` for a signal value consumed by a render pass). If the type represents a domain concept, name it after the concept.

## Documentation

Always keep it up to date after completing a large feature

## Roadmap

When completing a feature, check ROADMAP.md and check any box if we have completed it in the new feature.

- ALWAYS add tests to verify behaviour after completing a feature

## Testing

### Use TestEditor for tool tests

Tool and integration tests use `TestEditor` from `@/testing/TestEditor`. It creates a real Editor with the real NAPI backend. Tests break at compile time when APIs change.

```typescript
const editor = new TestEditor();
editor.startSession();
editor.selectTool("pen");
editor.click(100, 200);
expect(editor.pointCount).toBe(1);
```

### Never create mock context builders

Do not create functions like `createMockToolContext()` that return objects with `vi.fn()` stubs mirroring the Editor API. These create a parallel universe where tests pass even when real APIs are deleted.

### Assert on state, not mock calls

```typescript
// BAD — tests mock wiring, not behavior
expect(ctx.mocks.edit.addPoint).toHaveBeenCalledWith(100, 200, "onCurve", false);

// GOOD — tests actual outcome
expect(editor.pointCount).toBe(1);
```

For command tests, asserting that `ctx.bridge.addPoint` was called IS testing the command's behavior — but the test should also verify the command name, undo behavior, etc.

### Never create mock renderer tests

Do not create `createMockRenderer()` factories that return `vi.fn()` stubs for `IRenderer` methods. These tests assert on draw call sequences (`expect(renderer.moveTo).toHaveBeenCalledWith(...)`) which break on any refactor and don't verify visual correctness. Use snapshot tests or Playwright e2e instead for rendering verification.

### Keep tests lean

- 5-15 lines per test
- beforeEach under 5 lines (`new TestEditor()` + `startSession()` + `selectTool()`)
- No wrapper factories around TestEditor
- No tests for test infrastructure

## Frontend

### Base UI Components

All UI components must wrap [Base UI](https://base-ui.com/react/components) primitives:

- ALWAYS check if a Base UI component exists before creating a custom implementation
- Wrapper components live in `packages/ui/src/components/{componentName}/`
- Import Base UI as `import { Component as BaseComponent } from "@base-ui-components/react/component"`
- Export a wrapped version that applies project styling and extends the Base UI props
- Use the same name as Base UI (e.g., `Separator`, `Input`, `Tooltip`)

Example wrapper structure:

```tsx
import { Separator as BaseSeparator } from "@base-ui-components/react/separator";

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, ...props }, ref) => (
    <BaseSeparator ref={ref} className={cn("project-styles", className)} {...props} />
  ),
);
```

## Package Manager

This project uses **pnpm** (v9.0.0) as its package manager.

## Available Commands

### Development

- `pnpm dev` - Start the Electron app in development mode
- `pnpm dev:app` - Start with watch mode

### Code Quality

- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check formatting without modifying files
- `pnpm lint` - Lint code with Oxlint (auto-fix)
- `pnpm lint:check` - Lint code without auto-fix
- `pnpm typecheck` - Type check with tsgo
- `cargo fmt` - Format Rust code (run after any Rust changes)
- `cargo clippy` - Lint Rust code (run after any Rust changes)

### Testing

- `pnpm test` - Run tests once
- `pnpm test:watch` - Run tests in watch mode

### Building

- `pnpm build:native` - Build Rust native modules
- `pnpm build:native:debug` - Build native modules in debug mode
- `pnpm package` - Package the application
- `pnpm make` - Build and create distribution

### Glyph Info

- `pnpm generate:glyph-info` - Generate glyph data, decomposition, charsets, and FTS5 search index
- `pnpm glyph-info:repl` - Start interactive REPL with GlyphInfo pre-loaded

### Maintenance

- `pnpm clean` - Clean build artifacts and node_modules
- `pnpm check-deps` - Check for unused dependencies

## Project Structure

- `/src` - Electron app source (main, preload, renderer)
- `/crates` - Rust workspace (shift-core, shift-node)
- `/packages` - TypeScript packages

## Code Organization Rules

### Package vs App Code

- Geometry utilities (Vec2, Curve, Polygon) → import from `@shift/geo`
- Glyph-domain geometry (contour traversal, segment parsing, tight/x bounds) → import from `@shift/font`
- Core types (Point2D, Rect2D, PointId, ContourId) → import from `@shift/types`
- Snapshot utilities (findPointInSnapshot, etc.) → import from `@/lib/utils/snapshot`
- NEVER duplicate package code in app layer
- If you need functionality from a package, import it; don't copy it
- Do not synthesize fake point IDs for geometry-only operations
- Canonical glyph geometry APIs: `iterateRenderableContours`, `parseContourSegments`, `deriveGlyphTightBounds`, `deriveGlyphXBounds`

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
- Re-export types from their domain's index.ts for public API
- NEVER re-declare types that exist in `@shift/types` (generated from Rust). Import from `@shift/types`; for derived views (e.g. readonly, nested) use the domain pattern in `packages/types/src/domain.ts`

### Generated and domain types

- **Generated types** (from Rust via ts-rs) live ONLY in `packages/types/src/generated/`. Run `cargo test --package shift-core` to regenerate. They are the single source of truth for shapes and field names (e.g. `familyName`, `versionMajor`, not `family` or `version`).
- **Domain types** (e.g. `Point`, `Contour`, `Glyph`) live in `packages/types/src/domain.ts`. They MUST derive from generated types (e.g. `Readonly<PointSnapshot>`, `Omit` + composition). See `domain.ts`: same field names, no re-declaration of structure.
- **App layer**: NEVER re-declare types that exist in `@shift/types`. Import `FontMetadata`, `FontMetrics`, snapshot types, etc. from `@shift/types`. If you need a narrowed or immutable view, define it in `packages/types` (e.g. domain.ts) as a type derived from the generated type, not as a new interface in the app.
- Bridge and native layer are typed with `@shift/types`; engine and UI use those types and the same field names (e.g. `familyName` in the UI, not `family`).

### File Size Guidelines

- Single classes should not exceed 500 lines
- If a file grows beyond 300 lines, evaluate splitting by responsibility
- Prefer composition over monolithic classes

## Architectural Constraints

- **NEVER create Manager, Store, or Cache wrapper classes.** NativeBridge is the single interface to Rust. Do not wrap it in FooManager, FooStore, or FooCache. If you need derived data, compute it at the call site — NAPI calls are ~50μs.
- **NEVER create mock context builders** like `createMockToolContext()` or `createMockEditing()`. Tests use `TestEditor` (real Editor + real Rust) or `createBridge()` (real NativeBridge). No `vi.fn()` stubs for engine methods.
- **NEVER create CONTEXT.md files.** These are agent-generated dumps that go stale. Use `docs/architecture/` for architecture docs.
- \*\*NEVER import from `@/bridge/native`. Use `NativeBridge` — `getNative()` is internal. Enforced by lint.

## Anti-Slop Rules

These patterns are BANNED. Enforced by `scripts/oxlint/shift-plugin.mjs` and `.oxlintrc.json` lint rules.

- **Use Vec2 for all coordinate math.** Never `{ x: a.x - b.x, y: a.y - b.y }` — use `Vec2.sub(a, b)`.
- **Use Point2D in function signatures.** Never create `(x, y)` / `(Point2D)` overloads with `typeof` resolution code.
- **Use Glyphs/Contours packages for glyph traversal.** Never raw `for (const contour of glyph.contours) { for (const point ...) }` — use `Glyphs.findPoints` / `Glyphs.points` from `@shift/font`. Direct `.contours` access only in `packages/font/`, `bridge/draft.ts`.
- **No nested ternaries with map chains.** Break into named variables.
- **Blank lines between logical blocks.** Separate guard clauses, branches, and return statements with blank lines.
- **Do not add methods to Editor without justification.** Editor.ts is a facade with 150+ delegation methods. Ask: does it add logic? Can it be a pure function? Does it belong on NativeBridge?

## GlyphDraft — Immer-style two-tier mutations

`editor.createDraft()` returns a `GlyphDraft` for drag operations (translate, rotate, resize, bend). The draft separates JS preview (every frame) from Rust persistence (once at end):

- **`setPositions(updates)`** — calls `glyph.apply()` directly. JS-only, no NAPI, no Rust. Fires internal Glyph signals which trigger render effects.
- **`finish(label)`** — syncs final state to Rust via `restoreSnapshot` once, records undo.
- **`discard()`** — restores JS model from base snapshot. Rust was never modified.

**NEVER call `bridge.setNodePositions()` inside the draft hot path.** That sends N individual NAPI struct marshals to Rust per frame. For glyphs with thousands of points this causes ~450ms frames + GC pressure. The draft exists specifically to avoid this.

**Render effects track `glyph.contours` and `glyph.anchors`**, not `$glyph`. The `$glyph` signal on NativeBridge is for glyph identity (loaded/unloaded). Glyph data changes propagate through the Glyph model's internal signals. `#patchPositions` fires `#contours` with a new array reference so glyph-level effects see the change.

## Architecture References

- **Signal patterns & Editor conventions:** Read `lib/editor/Editor.ts` header comments
- **Tool structure & behavior system:** Read `lib/tools/core/BaseTool.ts`
- **Command organization:** Read `lib/commands/core/Command.ts`
