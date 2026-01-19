# Reactive - LLM Context

## Quick Facts

- **Purpose**: Fine-grained reactivity system with automatic dependency tracking
- **Language**: TypeScript
- **Key Files**: `signal.ts` (385 lines)
- **Dependencies**: None (standalone)
- **Dependents**: engine, editor, commands, tools (used throughout)

## File Structure

```
src/renderer/src/lib/reactive/
├── signal.ts           # Complete implementation
└── signal.test.ts      # Comprehensive test suite (530 lines)
```

## Core Abstractions

### Global State (signal.ts:11-20)

```typescript
let currentComputation: Computation | null = null; // Active context
let batchDepth = 0; // Nested batch count
const pendingEffects = new Set<EffectImpl>(); // Queued effects
let isNotifying = false; // Re-entrance guard
const pendingNotifications = new Set<SignalImpl>(); // Deferred notifications
```

### WritableSignal<T> (signal.ts:51-126)

```typescript
class SignalImpl<T> {
  #value: T;
  #subscribers = new Set<Computation>();

  get value(): T {
    if (currentComputation) {
      this.#subscribers.add(currentComputation);
      currentComputation.dependencies.add(this);
    }
    return this.#value;
  }

  set(newValue: T): void {
    if (!Object.is(this.#value, newValue)) {
      this.#value = newValue;
      this._notify();
    }
  }
}
```

### ComputedSignal<T> (signal.ts:144-224)

```typescript
class ComputedImpl<T> {
  #fn: () => T;
  #value: T | undefined;
  #dirty = true;
  #computing = false;
  dependencies = new Set<SignalNode>();

  get value(): T {
    if (this.#dirty && !this.#computing) {
      this.#recompute();
    }
    // Track as dependency...
    return this.#value!;
  }
}
```

### Effect (signal.ts:243-304)

```typescript
class EffectImpl {
  #fn: () => void | (() => void);
  #cleanup: (() => void) | null = null;
  #disposed = false;
  dependencies = new Set<SignalNode>();

  execute(): void {
    if (this.#disposed) return;
    this.#cleanup?.();
    // Clear old deps, run fn, collect new deps
    const result = this.#fn();
    if (typeof result === "function") {
      this.#cleanup = result;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#cleanup?.();
    // Unsubscribe from all dependencies
  }
}
```

## Key Patterns

### Dependency Tracking

```typescript
// During computation execution
currentComputation = this;
try {
  result = fn(); // Any signal.value reads will subscribe
} finally {
  currentComputation = null;
}
```

### Dirty Propagation

```typescript
// Computed marks dirty, notifies own subscribers
execute(): void {
  this.#dirty = true;
  // Notify downstream without recomputing (lazy)
  for (const sub of this.#subscribers) {
    sub.execute();
  }
}
```

### Batch Deferral

```typescript
function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      // Flush all queued effects
      for (const effect of pendingEffects) {
        effect.execute();
      }
      pendingEffects.clear();
    }
  }
}
```

## API Surface

| Function     | Signature                                    | Purpose                |
| ------------ | -------------------------------------------- | ---------------------- |
| `signal`     | `<T>(initial: T) => WritableSignal<T>`       | Create writable signal |
| `computed`   | `<T>(fn: () => T) => ComputedSignal<T>`      | Create derived signal  |
| `effect`     | `(fn: () => void \| (() => void)) => Effect` | Create side effect     |
| `batch`      | `<T>(fn: () => T) => T`                      | Batch updates          |
| `untracked`  | `<T>(fn: () => T) => T`                      | Read without tracking  |
| `isTracking` | `() => boolean`                              | Check reactive context |

## Common Operations

### Create reactive state

```typescript
const count = signal(0);
const doubled = computed(() => count.value * 2);
```

### React to changes

```typescript
const fx = effect(() => {
  document.title = `Count: ${count.value}`;
});
```

### Cleanup resources

```typescript
effect(() => {
  const id = setInterval(() => tick(), 1000);
  return () => clearInterval(id);
});
```

### Batch multiple updates

```typescript
batch(() => {
  x.set(newX);
  y.set(newY);
  z.set(newZ);
}); // Single effect execution
```

### Read without subscribing

```typescript
computed(() => {
  const tracked = a.value; // Creates dependency
  const ignored = b.peek(); // No dependency
  return tracked + ignored;
});
```

## Constraints and Invariants

1. **Object.is Equality**: Signals only notify if value actually changed
2. **Lazy Computed**: Computed values only recalculate when accessed
3. **Single Execution**: Effects don't re-enter during their own execution
4. **Cleanup Order**: Cleanup runs before re-execution and on dispose
5. **Batch Nesting**: Nested batches only flush at outermost batch end
6. **Dependency Cleanup**: Old dependencies unsubscribed on recomputation
7. **Re-entrance Safety**: Notifications during notify are deferred

## Design Guidance

### Signals vs Callbacks

- **Before**: `createManager(onChange?: () => void)` - manual notify
- **After**: `createManager()` with internal signals - automatic tracking

### Accessing Signal State

- `signal.value` - read AND track as dependency (use in effect/computed)
- `signal.peek()` - read WITHOUT tracking (use when building new values)

### Immutable Updates for Collections

```typescript
// Signals use Object.is() - mutating same object won't trigger
const set = signal(new Set());
set.value.add(1); // ❌ Won't notify - same Set reference

// Create new collection to trigger update
const next = new Set(set.peek());
next.add(1);
set.value = next; // ✅ New reference triggers notify
```
