# Core - LLM Context

## Quick Facts

- **Purpose**: Core utilities (EditEngine)
- **Language**: TypeScript
- **Key Files**: `EditEngine.ts`, `common.ts`
- **Dependencies**: types, engine/native
- **Dependents**: lib/editor, lib/tools, engine

## File Structure

```
src/renderer/src/lib/core/
├── EditEngine.ts         # Unified edit operations
└── common.ts             # CyclingCollection utility
```

## Core Abstractions

### EditEngine (EditEngine.ts)

```typescript
interface EditEngineContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}

class EditEngine {
  #ctx: EditEngineContext;

  applyEdits(
    selectedPoints: ReadonlySet<PointId>,
    dx: number,
    dy: number,
  ): PointId[] {
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

  current(): T {
    return this.#items[this.#index];
  }
  next(): T {
    this.#index = mod(this.#index + 1, this.length);
    return this.current();
  }
  prev(): T {
    this.#index = mod(this.#index - 1, this.length);
    return this.current();
  }
  peekNext(): T {
    return this.#items[mod(this.#index + 1, this.length)];
  }
  reset(): void {
    this.#index = 0;
  }

  static create<T>(items: T[]): CyclingCollection<T>;
}
```

## Key Patterns

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

| Class             | Method                       | Purpose      |
| ----------------- | ---------------------------- | ------------ |
| EditEngine        | applyEdits(selected, dx, dy) | Unified edit |
| CyclingCollection | next() / prev()              | Cycle items  |

## Common Operations

### Unified edits

```typescript
const engine = new EditEngine(ctx);
const affected = engine.applyEdits(new Set([pointId]), deltaX, deltaY);
// affected includes rule-moved handles
```

### Cycling collection

```typescript
const tools = CyclingCollection.create(["pen", "select", "hand"]);
tools.current(); // 'pen'
tools.next(); // 'select'
tools.next(); // 'hand'
tools.next(); // 'pen' (cycles)
```

## Constraints and Invariants

1. **Session Required**: EditEngine assumes active session
2. **JSON Parse**: EditEngine parses native JSON results
3. **Cycle Modulo**: CyclingCollection uses safe modulo for negative indices
