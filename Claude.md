# Shift Editor - Development Guide

## General Guidelines

- Prefer switch statements over long if-else chains when branching on the same value.
- Prefer early returns over nested if-else blocks. Return early for guard clauses to keep the main logic at the top indentation level.

## Documentation

Always keep it up to date after completing a large feature

## Roadmap

When completing a feature, check ROADMAP.md and check any box if we have completed it in the new feature.

- ALWAYS add tests to verify behaviour after completing a feature

## Testing

### Use TestEditor for tool tests

Tool and integration tests use `TestEditor` from `@/testing/TestEditor`. It creates a real Editor with MockFontEngine as the NAPI backend. Tests break at compile time when APIs change.

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

For command tests, asserting that `ctx.fontEngine.addPoint` was called IS testing the command's behavior — but the test should also verify the command name, undo behavior, etc.

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

### Tool Structure

All tools MUST follow this directory structure:

```
/tools/{toolName}/
  {ToolName}.ts    # Main tool class
  commands.ts      # Tool-specific commands (if needed)
  states.ts        # State types re-export (if needed)
  index.ts         # Public exports
```

### Command Organization

Commands follow this hierarchy:

```
/commands/
  core/           # Command, BaseCommand, CompositeCommand, CommandHistory
  primitives/     # Low-level: PointCommands, BezierCommands
  transform/      # TransformCommands
  clipboard/      # ClipboardCommands
```

Tool-specific command wrappers stay in their tool directories.

### Generated and domain types

- **Generated types** (from Rust via ts-rs) live ONLY in `packages/types/src/generated/`. Run `cargo test --package shift-core` to regenerate. They are the single source of truth for shapes and field names (e.g. `familyName`, `versionMajor`, not `family` or `version`).
- **Domain types** (e.g. `Point`, `Contour`, `Glyph`) live in `packages/types/src/domain.ts`. They MUST derive from generated types (e.g. `Readonly<PointSnapshot>`, `Omit` + composition). See `domain.ts`: same field names, no re-declaration of structure.
- **App layer**: NEVER re-declare types that exist in `@shift/types`. Import `FontMetadata`, `FontMetrics`, snapshot types, etc. from `@shift/types`. If you need a narrowed or immutable view, define it in `packages/types` (e.g. domain.ts) as a type derived from the generated type, not as a new interface in the app.
- Bridge and native layer are typed with `@shift/types`; engine and UI use those types and the same field names (e.g. `familyName` in the UI, not `family`).

### Signal Patterns

- The Editor class should expose signals via getters, not as raw public properties
- Writable signals should be private (`#` prefix) and exposed via read-only getters
- When effects need to track tool or state changes, explicitly depend on the relevant signals

```typescript
// GOOD: Expose via getter
private $activeTool: WritableSignal<ToolName>;
public get activeTool(): Signal<ToolName> {
  return this.$activeTool;
}

// BAD: Expose raw writable signal
public $activeTool: WritableSignal<ToolName>;
```

- Always access signal values through getters, never via `.value` or `.peek()` from outside the owning class. Getters encapsulate the signal and keep the reactive contract consistent. `.peek()` should only be used internally within the signal's owning class in computed signals where subscribing would cause circular updates.

```typescript
// GOOD: Use the getter
const zoom = viewport.zoomLevel;
const pan = viewport.panX;

// BAD: Reaching through to the signal
const zoom = viewport.zoom.value;
const zoom = viewport.zoom.peek();
```

### File Size Guidelines

- Single classes should not exceed 500 lines
- If a file grows beyond 300 lines, evaluate splitting by responsibility
- Prefer composition over monolithic classes

## Anti-Slop Rules

These patterns are BANNED. Enforced by `scripts/oxlint/shift-plugin.mjs` and `.oxlintrc.json` lint rules.

- **Use Vec2 for all coordinate math.** Never `{ x: a.x - b.x, y: a.y - b.y }` — use `Vec2.sub(a, b)`.
- **Use Point2D in function signatures.** Never create `(x, y)` / `(Point2D)` overloads with `typeof` resolution code.
- **Use Glyphs/Contours packages for glyph traversal.** Never raw `for (const contour of glyph.contours) { for (const point ...) }` — use `Glyphs.findPoints` / `Glyphs.points` from `@shift/font`. Direct `.contours` access only in `packages/font/`, `engine/draft.ts`, `engine/mock.ts`.
- **No nested ternaries with map chains.** Break into named variables.
- **Blank lines between logical blocks.** Separate guard clauses, branches, and return statements with blank lines.
- **Do not add methods to Editor without justification.** Editor.ts is a facade with 150+ delegation methods. Ask: does it add logic? Can it be a pure function? Does it belong on FontEngine?

## Mutation Architecture

All multi-frame glyph mutations (drags, transforms) use the GlyphDraft pattern:

```typescript
const draft = editor.createDraft();

// Every frame: apply position updates
draft.setPositions(updates);

// Commit: syncs to Rust + records undo
draft.finish("Move Points");

// Or cancel: restores base glyph
draft.discard();
```

- `draft.base` is the immutable starting snapshot
- `draft.setPositions(updates)` patches the base and emits to the glyph signal (Tier 1: TS-only)
- `draft.finish(label)` syncs final state to Rust (Tier 2) and records undo
- `draft.discard()` restores the base glyph

Tools own the transform math (buildTranslateUpdates, buildRotateUpdates, etc.) as pure functions. The draft owns the patching and lifecycle.

### Discrete mutations

One-shot mutations (toggleSmooth, addPoint, closeContour) go through FontEngine directly. These are Tier 3 — full Rust round-trip returning a new snapshot.

```typescript
editor.toggleSmooth(id);       // FontEngine.#dispatchVoid(raw.toggleSmooth(id))
editor.addPoint(edit);          // FontEngine.#dispatch(raw.addPoint(...))
```

### NAPI boundary

- All structured data crosses the boundary as JSON strings
- FontEngine owns `#execute`, `#dispatch`, `#dispatchVoid` for command dispatch
- `patchPositions` in `engine/draft.ts` handles Tier 1 optimistic glyph patching
- `syncNodePositions` handles Tier 2 lightweight Rust sync (no snapshot return)
- See `docs/architecture/rust-ts-boundary.md` for the full boundary design
