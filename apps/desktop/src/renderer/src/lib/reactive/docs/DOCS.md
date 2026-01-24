# Reactive

Fine-grained reactivity system providing automatic dependency tracking and efficient updates.

## Overview

The reactive library implements a signals-based reactivity system inspired by SolidJS and Preact Signals. It provides automatic dependency tracking during reads, lazy evaluation for computed values, and batched effect execution for performance.

## Architecture

```
signal<T>()
    ↓ writes
#subscribers: Set<Computation>
    ↓ notifies
computed<T>() / effect()
    ↓ reads (auto-tracks)
signal.value
```

### Key Design Decisions

1. **Automatic Tracking**: Dependencies captured during computation execution
2. **Lazy Computed**: Only recomputes when accessed after becoming dirty
3. **Batched Effects**: Effects queued during batch, executed at batch end
4. **Cleanup Support**: Effects can return cleanup functions

## Signal Naming Convention

Classes that use signals follow a consistent naming pattern:

**Internal (private) fields use `$` prefix:**
```typescript
private readonly $zoom: WritableSignal<number>;
private readonly $selectedPointIds: WritableSignal<ReadonlySet<PointId>>;
```

**Public getters return the Signal (not the value):**
```typescript
public get zoom(): Signal<number> {
  return this.$zoom;
}
```

**Usage patterns:**
```typescript
// Reactive - component re-renders on change
const zoom = useValue(editor.zoom);

// Non-reactive - reads without tracking ("unsafe" escape hatch)
const zoom = editor.zoom.peek();
```

**Design principle:** The `$` prefix is internal documentation indicating a signal field. Use `private` keyword (not `#`) for signal fields to avoid `#$` awkwardness. Users opt into reactivity with `useValue()`, and use `.peek()` for imperative non-reactive reads.

## When to Use Signals

**Use signals for:**

- Continuous state that changes over time (selection, hover, zoom)
- State accessed by multiple consumers
- Derived/computed values
- UI state that triggers redraws

**Use signals + effect() for:**

- Triggering side effects when state changes
- Auto-subscribing to dependencies
- Cleanup on state change (return cleanup function)

**Don't use signals for:**

- One-shot operations (use functions)
- Event payloads with specific data (if you need to know _what_ changed, pass it directly)
- State that never changes after initialization
- React component state that doesn't need editor access (use Zustand)

**Signals vs Zustand:**

- **Signals**: Editor internals (canvas, rendering, tools, commands)
- **Zustand**: React UI state (filename, active tool, panels, preferences)

**Editor Access Pattern:**

The Editor singleton is stored in Zustand but accessed via `getEditor()`:

```typescript
import { getEditor } from "@/store/store";

// In React components, effects, callbacks, or non-React code
const editor = getEditor();
editor.doSomething();
```

The Editor is a stable singleton that never changes, so `getEditor()` works everywhere without needing a React hook.

**Pattern: Manager + Signals**

```typescript
class SelectionManager {
  private $selectedPoints: WritableSignal<ReadonlySet<PointId>>;

  constructor() {
    this.$selectedPoints = signal<ReadonlySet<PointId>>(new Set());
  }

  // Public getter returns the Signal for reactive access
  get selectedPoints(): Signal<ReadonlySet<PointId>> {
    return this.$selectedPoints;
  }

  // Mutator uses peek() to read without tracking
  addToSelection(id: PointId): void {
    const next = new Set(this.$selectedPoints.peek());
    next.add(id);
    this.$selectedPoints.set(next);
  }
}

// React component subscribes via useValue()
function MyComponent() {
  const selectedPoints = useValue(manager.selectedPoints);
  return <div>Selected: {selectedPoints.size}</div>;
}

// Effect subscribes via .value
effect(() => {
  manager.selectedPoints.value; // Tracks dependency
  redraw();
});
```

## Key Concepts

### Signals

Writable reactive values that notify subscribers on change:

```typescript
const count = signal(0);

// Read (tracks dependency if in reactive context)
console.log(count.value);

// Write (notifies subscribers)
count.set(1);
count.update((n) => n + 1);

// Read without tracking
count.peek();
```

### Computed

Derived values that auto-update when dependencies change:

```typescript
const doubled = computed(() => count.value * 2);

// Lazy - only computes when accessed
console.log(doubled.value);

// Auto-recomputes when count changes
count.set(5);
console.log(doubled.value); // 10
```

### Effects

Side effects that re-run when dependencies change:

```typescript
const fx = effect(() => {
  console.log("Count is:", count.value);

  // Optional cleanup
  return () => console.log("Cleaning up");
});

// Stop the effect
fx.dispose();
```

### Batching

Defer effect execution for multiple updates:

```typescript
batch(() => {
  a.set(1);
  b.set(2);
  c.set(3);
}); // Effects run once, not three times
```

## API Reference

### signal<T>(initial: T): WritableSignal<T>

- `.value` - Get/set the value (tracks on read)
- `.set(value)` - Set new value
- `.update(fn)` - Functional update
- `.peek()` - Read without tracking

### computed<T>(fn: () => T): ComputedSignal<T>

- `.value` - Get derived value (lazy, cached)
- `.invalidate()` - Force recomputation on next access

### effect(fn: () => void | (() => void)): Effect

- Returns Effect with `.dispose()` method
- Function can return cleanup callback

### batch<T>(fn: () => T): T

- Defers effect execution until batch completes
- Supports nesting

### untracked<T>(fn: () => T): T

- Execute without tracking dependencies

### isTracking(): boolean

- Check if currently in reactive context

## Usage Examples

### Basic Reactivity

```typescript
const name = signal("Alice");
const greeting = computed(() => `Hello, ${name.value}!`);

effect(() => {
  console.log(greeting.value);
});

name.set("Bob"); // Logs: "Hello, Bob!"
```

### Dynamic Dependencies

```typescript
const condition = signal(true);
const a = signal(1);
const b = signal(2);

const value = computed(() => (condition.value ? a.value : b.value));

// Initially depends only on `condition` and `a`
// When condition becomes false, depends on `condition` and `b`
```

### Cleanup Pattern

```typescript
effect(() => {
  const handler = () => console.log(signal.value);
  window.addEventListener("resize", handler);

  return () => {
    window.removeEventListener("resize", handler);
  };
});
```

### Batch Updates

```typescript
const x = signal(0);
const y = signal(0);
let renderCount = 0;

effect(() => {
  renderCount++;
  render(x.value, y.value);
});

// Without batch: renderCount = 3
// With batch: renderCount = 2
batch(() => {
  x.set(100);
  y.set(200);
});
```

## Data Flow

```
Signal Write (set/update)
    ↓
Object.is equality check
    ↓ (if changed)
_notify() subscribers
    ↓
For each subscriber:
    ├── Computed: mark dirty (lazy)
    └── Effect: execute (or queue if batching)
        ↓
During execution:
    signal.value reads → auto-subscribe
        ↓
Cleanup old dependencies
Subscribe to new dependencies
```

## Related Systems

- [engine](../../engine/docs/DOCS.md) - Uses signals for snapshot state
- [editor](../editor/docs/DOCS.md) - Effects for redraw triggers
- [commands](../commands/docs/DOCS.md) - Signals for undo/redo state
- [tools](../tools/docs/DOCS.md) - State machines use signals
