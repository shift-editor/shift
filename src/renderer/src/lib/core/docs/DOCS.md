# Core

Core utilities including EventEmitter pub/sub and EditEngine.

## Overview

The core library provides foundational utilities used throughout the Shift editor. It includes an EventEmitter for pub/sub communication and the EditEngine for unified edit operations.

## Architecture

```
EventEmitter
├── #listeners: Map<EventName, Handler[]>
├── on(event, handler)
├── emit(event, data)
└── off(event, handler)

EditEngine
├── #ctx: EditEngineContext
└── applyEdits(selectedPoints, dx, dy) → PointId[]
```

### Key Design Decisions

1. **Generic EventEmitter**: Type-safe events with generic handlers
2. **EditEngine Abstraction**: Unified interface for rule-based edits

## Key Concepts

### EventEmitter

Type-safe pub/sub for application events:

```typescript
const emitter = new EventEmitter();

emitter.on('points:added', (ids: PointId[]) => {
  console.log('Added points:', ids);
});

emitter.emit('points:added', [pointId1, pointId2]);
```

### EditEngine

Unified edit operations with rule matching:

```typescript
const engine = new EditEngine(ctx);

const affected = engine.applyEdits(
  selectedPoints,  // Set<PointId>
  dx, dy           // Movement delta
);
// Returns all affected point IDs including rule-moved handles
```

## API Reference

### EventEmitter
- `on<T>(event, handler): void` - Subscribe
- `emit<T>(event, data): void` - Publish
- `off<T>(event, handler): void` - Unsubscribe

### EditEngine
- `applyEdits(selectedPoints, dx, dy): PointId[]` - Apply edits with rules

### Event Types
- `'points:added'` - Point creation
- `'points:moved'` - Point movement
- `'points:removed'` - Point deletion
- `'segment:upgraded'` - Segment type change
- `'font:loaded'` - Font load complete

## Usage Examples

### EventEmitter
```typescript
const emitter = new EventEmitter();

// Subscribe
const handler = (ids: PointId[]) => {
  console.log('Points added:', ids);
};
emitter.on('points:added', handler);

// Publish
emitter.emit('points:added', [newPointId]);

// Unsubscribe
emitter.off('points:added', handler);
```

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
