# Reactive

Fine-grained reactivity system providing automatic dependency tracking and efficient updates for the Shift editor.

## Architecture Invariants

- **Architecture Invariant:** Signals use `Object.is` equality by default. Mutating an object in place and re-setting the same reference will **not** notify subscribers. Always create a new reference (e.g., `new Set(...)`) to trigger updates.
- **Architecture Invariant:** `computed` is lazy -- it only recomputes when `.value` is accessed after a dependency change. It never eagerly evaluates. Accessing `.value` inside a `batch` returns the up-to-date derived value immediately.
- **Architecture Invariant:** `effect` runs its callback immediately on construction (synchronously). It is not deferred to the next microtask.
- **Architecture Invariant:** During `batch`, only effects are deferred. Computed values remain available with fresh data inside the batch body.
- **Architecture Invariant: CRITICAL:** The module-level `currentComputation` variable is the sole mechanism for dependency tracking. Any code that saves/restores it incorrectly will silently break the entire reactive graph. `untracked` and the internal `#recompute`/`execute` methods carefully save and restore this variable.
- **Architecture Invariant: CRITICAL:** Re-entrant notification is guarded by the `isNotifying` flag. Signals written during notification are queued in `pendingNotifications` and flushed after the current notification pass. Without this, subscribers could see inconsistent state.
- **Architecture Invariant:** Signal-bearing fields and accessors use the `*Cell` suffix. The plain noun is the unwrapped snapshot value: `zoomCell` is `Signal<number>`, `zoom` is `number`.
- **Architecture Invariant: Convention:** `fooCell` accessors are for raw state or cheap computeds that are safe to subscribe to via `useSignalState`/`useSignalTrigger`. Expensive derived values (bounds, paths, sidebearings) are exposed as plain getters and pulled on demand. For React live display of a derived value, write a purpose-specific hook (e.g. `useSelectionBounds`) that subscribes to the raw inputs and pulls the getter at render time.
- **Architecture Invariant:** `ComputedSignal.dispose()` clears both its `dependencies` and its `#subscribers`. Anything that was reaching the source signal _through_ this computed loses that path. If the consumer needs to keep firing across the lifetime of the source, it must hold a **direct** subscription to the source — not rely on a chain that passes through a disposable intermediate (e.g. an LRU-cached object's computed).

## Codemap

```
signals/
  signal.ts          — signal, computed, effect, batch, untracked, isTracking
  useSignal.ts       — useSignalState, useSignalTrigger (React bridges)
  index.ts           — public re-exports
  signal.test.ts     — unit tests (vitest)
```

Purpose-specific hooks for derived values live under `hooks/`:

- `useSelectionBounds` — current selection bounds, pulled at render time.
- `useGlyphSidebearings` — current LSB/RSB, pulled at render time.
- `useGlyphXAdvance` — current xAdvance.

## Key Types

- `Signal<T>` -- read-only reactive value. `.value` tracks dependencies; `.peek()` reads without tracking.
- `WritableSignal<T>` -- extends `Signal<T>` with `.set()`, `.update()`, and writable `.value`.
- `ComputedSignal<T>` -- extends `Signal<T>` with `.invalidate()` to force recomputation on next access.
- `Effect` -- handle returned by `effect()` with a `.dispose()` method.
- `SignalOptions<T>` -- optional config with `equals` for custom equality (pass `() => false` to always notify).
- `Computation` -- internal interface for anything that tracks dependencies (`execute()` + `dependencies`).
- `SignalNode` -- internal interface for anything that can be unsubscribed from (`_unsubscribe()`).

## How it works

**Dependency tracking.** A module-level `currentComputation` variable holds the active `Computation` (either a `ComputedImpl` or `EffectImpl`). When a signal's `.value` getter runs, it checks `currentComputation` and, if non-null, adds the computation to its subscriber set and adds itself to the computation's dependency set. This creates a bidirectional link.

**Cleanup on re-run.** Before each re-execution, both `ComputedImpl` and `EffectImpl` unsubscribe from all previous dependencies and clear their dependency set. The new execution then re-tracks only the dependencies actually read, which enables dynamic dependency graphs (e.g., conditional branches that read different signals).

**Notification.** `SignalImpl.set()` checks equality, then calls `_notify()`. During notification, subscriber computations are copied to an array to avoid mutation-during-iteration issues. Each subscriber's `execute()` is called. For `ComputedImpl`, `execute()` just marks it dirty and propagates to its own subscribers (lazy chain). For `EffectImpl`, `execute()` runs the effect body.

**Batching.** `batch()` increments a `batchDepth` counter. While `batchDepth > 0`, effects are added to `pendingEffects` instead of executed. When the outermost batch exits, all pending effects run. Nested batches are supported via depth counting.

**Re-entrant writes.** If a signal is written during `_notify()` (i.e., an effect writes another signal), the `isNotifying` flag causes the write to be queued in `pendingNotifications`. After the current notification pass finishes, queued signals are flushed.

**React bridge.** `useSignalState` uses React's `useSyncExternalStore`. It creates an `effect` that reads `signal.value` (establishing tracking) and calls the store's `callback` on change. The snapshot function uses `.peek()` to avoid double-tracking.

## Workflow recipes

### Add a new reactive property to a manager class

1. Add a private `fieldNameCell: WritableSignal<T>` field.
2. Initialize it in the constructor: `this.fieldNameCell = signal(initialValue)`.
3. Add a public getter for the snapshot value: `get fieldName(): T { return this.fieldNameCell.peek(); }`.
4. Add a public getter for the signal when callers need reactivity: `get fieldNameCell(): Signal<T> { return this.fieldNameCell; }`.
5. Write mutators that call `this.fieldNameCell.set(newValue)` or `.update(fn)`.

### Subscribe to a signal in a React component

1. Import `useSignalState` from `@/lib/signals`.
2. Call `const value = useSignalState(someSignal)` in the component body.
3. The component re-renders when the signal changes.

### Run a side effect tied to component lifecycle

1. Import `useSignalEffect` from `@/hooks/useSignalEffect`.
2. Call `useSignalEffect(() => { someSignal.value; /* side effect */ })` inside the component. The effect auto-disposes on unmount.

### Read a signal imperatively (no tracking)

Use `.peek()` inside mutators or event handlers where you need the current value but do not want to establish a reactive dependency.

### Force-notify even when the reference is the same

Pass `{ equals: () => false }` as the second argument to `signal()`. This is useful for mutable objects where identity does not change but contents do.

## Gotchas

- **Object mutation is invisible.** Mutating properties on a signal's current value does not trigger updates. You must `.set()` a new reference.
- **Effects run synchronously.** Setting a signal inside an effect body can trigger other effects immediately (unless inside a `batch`). Careless writes inside effects can cause cascading re-executions.
- **Computed propagates eagerly on dirty, evaluates lazily.** When a computed's dependency changes, it marks itself dirty and immediately notifies its own subscribers (which may be other computeds or effects). But it does not recompute its value until `.value` is accessed.
- **`peek()` inside a computed breaks reactivity.** If a computed reads a signal via `.peek()`, it will not re-derive when that signal changes. This is intentional but easy to forget.
- **Use `track(cell)` for invalidation-only dependencies.** Inside a computed/effect, prefer `track(fooCell)` when the code needs to subscribe to `fooCell` but does not need the current value. Prefer `const foo = fooCell.value` when the value is actually used.
- **Circular computed chains.** There is no cycle detection. A computed that reads itself (directly or indirectly) will hit the `#computing` re-entrancy guard and return the stale value.
- **`useSignalState` must not be called conditionally.** It is a React hook and follows the rules of hooks.
- **Disposing a computed silently breaks chains that flowed through it.** If `A -> B -> C` (A is a source signal, B is a computed, C subscribes to B), and B is disposed, A no longer notifies C -- but C does not know it has been orphaned. Pattern: when C's lifetime can outlive B's, give C a direct edge to A in addition to the indirect one.

## Verification

```bash
# Run reactive module tests
cd apps/desktop && npx vitest run src/renderer/src/lib/signals/signal.test.ts

# Run full test suite
cd apps/desktop && npm test
```

## Related

- `Editor` -- primary consumer; holds `WritableSignal` fields for tool state, cursor, preview mode
- `Camera` -- uses `zoomCell`, pan cells, and affine transform cells
- `Hover` -- uses `targetCell` for hovered editor state
- `Selection` -- uses `WritableSignal` fields for selected point/anchor/segment state
- `NativeBridge` -- uses a glyph identity cell with `equals: () => false` for identity changes
- `useSignalState` -- React bridge hook (in this module)
- `useSignalEffect` -- lifecycle-aware effect hook (in `@/hooks/useSignalEffect`)
- `WorkspaceEditCoordinator` -- uses signals for settled and commit lifecycle state
