# Shift Editor - Development Guide

## General Guidelines

- Prefer switch statements over long if-else chains when branching on the same value.

```typescript
// Prefer
switch (canvas) {
  case interactiveCanvas:
    interactiveContext.resizeCanvas(canvas);
    break;
  case overlayCanvas:
    overlayContext.resizeCanvas(canvas);
    break;
  case staticCanvas:
    staticContext.resizeCanvas(canvas);
    break;
}

// Avoid long if-else
if (canvas === interactiveCanvas) {
  interactiveContext.resizeCanvas(canvas);
} else if (canvas === overlayCanvas) {
  overlayContext.resizeCanvas(canvas);
} else if (canvas === staticCanvas) {
  staticContext.resizeCanvas(canvas);
}
```

- Prefer early returns over nested if-else blocks. Return early for guard clauses to keep the main logic at the top indentation level.

```typescript
// Prefer
if (rect === null) {
  this.#marqueePreviewPointIds.set(null);
  return;
}

const points = this.getAllPoints();
const ids = points.filter((p) => pointInRect(p, rect)).map((p) => p.id);
this.#marqueePreviewPointIds.set(new Set(ids));

// Avoid
if (rect === null) {
  this.#marqueePreviewPointIds.set(null);
} else {
  const points = this.getAllPoints();
  const ids = new Set(points.filter((p) => pointInRect(p, rect)).map((p) => p.id));
  this.#marqueePreviewPointIds.set(ids);
}
```

## Documentation

Always keep it up to date after completing a large feature

## Roadmap

When completing a feature, check ROADMAP.md and check any box if we have completed it in the new feature.

- ALWAYS add tests to verify behaviour after completing a feature

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

### Testing

- `pnpm test` - Run tests once
- `pnpm test:watch` - Run tests in watch mode

### Building

- `pnpm build:native` - Build Rust native modules
- `pnpm build:native:debug` - Build native modules in debug mode
- `pnpm package` - Package the application
- `pnpm make` - Build and create distribution

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
- Core types (Point2D, Rect2D, PointId, ContourId) → import from `@shift/types`
- Snapshot utilities (findPointInSnapshot, etc.) → import from `@/lib/utils/snapshot`
- NEVER duplicate package code in app layer
- If you need functionality from a package, import it; don't copy it

### Import Conventions

- `@shift/*` for imports from packages (external-facing shared code)
- `@/*` for app-wide imports (from renderer/src root)
- Relative imports (`./`, `../`) only within the same module directory
- Never mix import styles for the same module
- **Never use inline type imports** such as `import("@shift/types").PointId` or `import("@/types/hitResult").ContourEndpointHit`. Always use top-level imports: `import type { PointId } from "@shift/types"` or `import type { ContourEndpointHit } from "@/types/hitResult"`.

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
