# Shift Editor - Development Guide

## General Guidelines

- Avoid adding comments unless absolutely neccessary.
- ALWAYS add tests to verify behaviour after completing a feature
- ALWAYS keep documentation up to date
- Consult the documentation and code together
- When completing a feature YOU MUST check if it ticks off an item in the roadmap, and tick it off if so

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

## Pre-commit Hooks

This project uses [pre-commit](https://pre-commit.com/) for git hooks. Install with `pre-commit install`.

Hooks run on each commit:

- **File hygiene**: trailing whitespace, end-of-file fixer, YAML validation, large file checks
- **Rust**: `cargo fmt`, `cargo clippy`, `cargo test`
- **TypeScript/JavaScript**: Prettier formatting, Oxlint, tsgo typecheck, Vitest

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

### Type Definitions

- Domain types belong in `/types/{domain}.ts`, not in implementation files
- NEVER define types (interfaces, type aliases, enums) directly in classes or service files
- Types should be imported from dedicated type files
- Re-export types from their domain's index.ts for public API

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

### Generated Types

- Rust-generated types live ONLY in `@shift/types/generated`
- Run `cargo test --package shift-core` to regenerate
- Desktop app imports from `@shift/types`, never maintains its own copy

### File Size Guidelines

- Single classes should not exceed 500 lines
- If a file grows beyond 300 lines, evaluate splitting by responsibility
- Prefer composition over monolithic classes
