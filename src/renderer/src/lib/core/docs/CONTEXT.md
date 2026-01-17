# Core - LLM Context

## Quick Facts
- **Purpose**: Core utilities (EventEmitter, UndoManager, EditEngine)
- **Language**: TypeScript
- **Key Files**: `EventEmitter.ts`, `UndoManager.ts`, `EditEngine.ts`, `common.ts`
- **Dependencies**: types, engine/native
- **Dependents**: lib/editor, lib/tools, engine

## File Structure
```
src/renderer/src/lib/core/
├── EventEmitter.ts       # Pub/sub implementation
├── EventEmitter.test.ts  # Tests
├── UndoManager.ts        # Command stack
├── EditEngine.ts         # Unified edit operations
└── common.ts             # CyclingCollection utility
```

## Core Abstractions

### EventEmitter (EventEmitter.ts)
```typescript
class EventEmitter implements IEventEmitter {
  #listeners = new Map<EventName, EventHandler<any>[]>();

  on<T>(event: EventName, handler: EventHandler<T>): void {
    const handlers = this.#listeners.get(event) ?? [];
    handlers.push(handler);
    this.#listeners.set(event, handlers);
  }

  emit<T>(event: EventName, data: T): void {
    const handlers = this.#listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler(data);
    }
  }

  off<T>(event: EventName, handler: EventHandler<T>): void {
    const handlers = this.#listeners.get(event) ?? [];
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  }
}
```

### UndoManager (UndoManager.ts)
```typescript
interface Command {
  undo(): void;
}

class UndoManager {
  #stack: Command[] = [];

  push(command: Command): void {
    this.#stack.push(command);
  }

  peek(): Command | undefined {
    return this.#stack[this.#stack.length - 1];
  }

  undo(): void {
    const command = this.#stack.pop();
    command?.undo();
  }

  clear(): void {
    this.#stack = [];
  }
}
```

### EditEngine (EditEngine.ts)
```typescript
interface EditEngineContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}

class EditEngine {
  #ctx: EditEngineContext;

  applyEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    const idStrings = Array.from(selectedPoints);
    const resultJson = this.#ctx.native.applyEditsUnified(idStrings, dx, dy);
    const result = JSON.parse(resultJson);

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    return result.affectedPointIds.map(asPointId);
  }
}
```

### CyclingCollection (common.ts)
```typescript
class CyclingCollection<T> {
  #items: T[];
  #index = 0;

  current(): T { return this.#items[this.#index]; }
  next(): T { this.#index = mod(this.#index + 1, this.length); return this.current(); }
  prev(): T { this.#index = mod(this.#index - 1, this.length); return this.current(); }
  peekNext(): T { return this.#items[mod(this.#index + 1, this.length)]; }
  reset(): void { this.#index = 0; }

  static create<T>(items: T[]): CyclingCollection<T>;
}
```

## Key Patterns

### Type-Safe Events
```typescript
// Event types defined in types/events.ts
type EventName = 'points:added' | 'points:moved' | 'points:removed' | ...;

// Type-safe subscription
emitter.on<PointId[]>('points:added', (ids) => {
  // ids is PointId[]
});
```

### Handler Reference for Unsubscribe
```typescript
// Must keep reference to unsubscribe
const handler = (ids: PointId[]) => { /* ... */ };
emitter.on('points:added', handler);
emitter.off('points:added', handler);  // Same reference required
```

### EditEngine Context Injection
```typescript
const ctx = {
  native: window.shiftFont,
  hasSession: () => sessionManager.isActive(),
  emitSnapshot: (s) => snapshotSignal.set(s),
};

const engine = new EditEngine(ctx);
```

## API Surface

| Class | Method | Purpose |
|-------|--------|---------|
| EventEmitter | on(event, handler) | Subscribe |
| EventEmitter | emit(event, data) | Publish |
| EventEmitter | off(event, handler) | Unsubscribe |
| UndoManager | push(cmd) | Add to stack |
| UndoManager | undo() | Pop and execute |
| UndoManager | clear() | Empty stack |
| EditEngine | applyEdits(selected, dx, dy) | Unified edit |
| CyclingCollection | next() / prev() | Cycle items |

## Common Operations

### Pub/sub pattern
```typescript
const emitter = new EventEmitter();

// Subscribe
emitter.on('font:loaded', (font) => {
  console.log('Font loaded:', font.name);
});

// Publish
emitter.emit('font:loaded', loadedFont);
```

### Undo stack
```typescript
const undo = new UndoManager();

// Before mutation
const prev = getState();
mutate();
undo.push({ undo: () => setState(prev) });

// Undo
undo.undo();
```

### Unified edits
```typescript
const engine = new EditEngine(ctx);
const affected = engine.applyEdits(
  new Set([pointId]),
  deltaX,
  deltaY
);
// affected includes rule-moved handles
```

### Cycling collection
```typescript
const tools = CyclingCollection.create(['pen', 'select', 'hand']);
tools.current();  // 'pen'
tools.next();     // 'select'
tools.next();     // 'hand'
tools.next();     // 'pen' (cycles)
```

## Event Types (types/events.ts)

```typescript
type EventName =
  | 'points:added'     // PointId[]
  | 'points:moved'     // { ids: PointId[], dx, dy }
  | 'points:removed'   // PointId[]
  | 'segment:upgraded' // SegmentUpgradeData
  | 'font:loaded';     // Font
```

## Constraints and Invariants

1. **Handler Reference**: Must keep reference for off() to work
2. **No Redo**: UndoManager only supports undo, not redo
3. **Session Required**: EditEngine assumes active session
4. **JSON Parse**: EditEngine parses native JSON results
5. **Cycle Modulo**: CyclingCollection uses safe modulo for negative indices
