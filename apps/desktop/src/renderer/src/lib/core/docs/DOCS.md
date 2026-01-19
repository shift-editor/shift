# Core

Core utilities including EditEngine for unified edit operations.

## Overview

The core library provides foundational utilities used throughout the Shift editor. It includes the EditEngine for unified edit operations.

## Architecture

```
EditEngine
├── #ctx: EditEngineContext
└── applyEdits(selectedPoints, dx, dy) → PointId[]
```

### Key Design Decisions

1. **EditEngine Abstraction**: Unified interface for rule-based edits

## Key Concepts

### EditEngine

Unified edit operations with rule matching:

```typescript
const engine = new EditEngine(ctx);

const affected = engine.applyEdits(
  selectedPoints, // Set<PointId>
  dx,
  dy, // Movement delta
);
// Returns all affected point IDs including rule-moved handles
```

## API Reference

### EditEngine

- `applyEdits(selectedPoints, dx, dy): PointId[]` - Apply edits with rules

## Usage Examples

### EditEngine

```typescript
const ctx = {
  native: window.shiftFont,
  hasSession: () => true,
  emitSnapshot: (s) => snapshot.set(s),
};

const engine = new EditEngine(ctx);

// Move selected points with automatic rule application
const selected = new Set([pointId1, pointId2]);
const affectedIds = engine.applyEdits(selected, 10, 5);

// affectedIds includes original points + any handles moved by rules
```

## Data Flow

```
EditEngine.applyEdits(selected, dx, dy)
    ↓
Convert PointIds to strings
    ↓
ctx.native.applyEditsUnified(idStrings, dx, dy)
    ↓
Parse JSON result
    ↓
ctx.emitSnapshot(result.snapshot)
    ↓
Return result.affectedPointIds as PointId[]
```

## Related Systems

- [commands](../commands/docs/DOCS.md) - Higher-level command history
- [engine](../../engine/docs/DOCS.md) - FontEngine uses EditEngine
- [reactive](../reactive/docs/DOCS.md) - Signals for state
