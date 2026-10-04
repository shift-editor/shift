# Reactive

<!-- reviewed: 2026-10-04 review-every: 90d -->

Fine-grained reactivity system providing automatic dependency tracking and efficient updates for the Shift editor.

For rules on writing and reviewing reactive code, and triage when something doesn't update, load the `signals` skill. This file documents how the library works.

## Architecture Invariants

- **Architecture Invariant:** Signals use `Object.is` equality by default. Mutating an object in place and re-setting the same reference will **not** notify subscribers. Always create a new reference (e.g., `new Set(...)`) to trigger updates.
- **Architecture Invariant:** `computed` is lazy -- it only recomputes when `.value` is accessed after a dependency change. It never eagerly evaluates. Accessing `.value` inside a `batch` returns the up-to-date derived value immediately.
- **Architecture Invariant:** A computed that recomputes to an equal value (by `ComputedOptions.equals`, default `Object.is`) keeps its previous value and does not rerun its readers. An effect runs only when a dependency actually changed value, never merely because an ancestor was written.
- **Architecture Invariant:** Data mutated in place is published through a revision, never by re-setting the same object. The hot-path coordinate buffers (`ContourBuffer`, `AnchorBuffer`, `ComponentBuffer`) keep their `PackedArray` in a plain field, bump a `revision` signal after each in-place change, and expose a fresh `subarray` view per revision. Every value that crosses a signal therefore has a new identity when it changes, so `Object.is` comparison is sound everywhere.
- **Architecture Invariant:** An unscheduled `effect` runs its callback immediately on construction (synchronously). An effect created with `EffectOptions.schedule` instead defers **every** run — including the first — through the provided scheduler, coalescing repeated triggers into one run; `Effect.cancel()` drops a pending scheduled run without disposing the effect. `useSignalState` uses this with `{ schedule: "frame" }` to defer notifications to `requestAnimationFrame`.
- **Architecture Invariant:** During `batch`, only effects are deferred. Computed values remain available with fresh data inside the batch body.
- **Architecture Invariant: CRITICAL:** The module-level `currentComputation` variable is the sole mechanism for dependency tracking. Any code that saves/restores it incorrectly will silently break the entire reactive graph. `untracked` and the internal `#recompute`/`execute` methods carefully save and restore this variable.
- **Architecture Invariant: CRITICAL:** A write only marks nodes stale; marking never runs user code. Unscheduled effects run afterwards in a flush at the end of the write (or the outermost `batch`), so an effect never observes a half-updated graph, and an effect reached through several paths runs once.
- **Architecture Invariant:** Signal-bearing fields and accessors use the `*Cell` suffix. The plain noun is the unwrapped snapshot value: `zoomCell` is `Signal<number>`, `zoom` is `number`.
- **Architecture Invariant: Convention:** `fooCell` accessors are for raw state or cheap computeds that are safe to subscribe to via `useSignalState`. Expensive derived values (bounds, paths, sidebearings) are exposed as plain getters and pulled on demand. For React live display of a derived value, write a purpose-specific hook (e.g. `useSelectionBounds`) that subscribes to the raw inputs and pulls the getter at render time.
- **Architecture Invariant:** Signal diagnostics retain only weak references to nodes. Registry-wide inspection sees live nodes, including externally owned disposed nodes, but does not keep an otherwise unowned graph alive; garbage collection determines when nodes disappear.
- **Architecture Invariant:** `ComputedSignal.dispose()` clears both its `dependencies` and its `#subscribers`. Anything that was reaching the source signal _through_ this computed loses that path. If the consumer needs to keep firing across the lifetime of the source, it must hold a **direct** subscription to the source — not rely on a chain that passes through a disposable intermediate (e.g. an LRU-cached object's computed).

## Codemap

```
signals/
  signal.ts          — signal, computed, effect, batch, untracked, isTracking
  useSignal.ts       — useSignalState (React bridge; optional frame scheduling)
  index.ts           — public re-exports
apps/desktop/src/renderer/src/lib/signals/
  signal.test.ts     — unit tests (vitest)
  signalCollection.test.ts — real-GC graph ownership and disposal tests
```

A second React bridge, `useSignalEffect` (lifecycle-scoped effect), lives in `@/hooks/useSignalEffect`. Purpose-specific hooks for derived values live under `hooks/`:

- `useSelectionBounds` — current selection bounds, pulled at render time.

The shared glyph sidebar reads live sidebearings and advance through `useGlyphMetrics` in `packages/editor/src/ui`.

## Key Types

- `Signal<T>` -- read-only reactive value. `.value` tracks dependencies; `.peek()` reads without tracking.
- `WritableSignal<T>` -- extends `Signal<T>` with `.set()`, `.update()`, and writable `.value`.
- `ComputedSignal<T>` -- extends `Signal<T>` with `.invalidate()` to force recomputation on next access.
- `Effect` -- handle returned by `effect()` with `.dispose()` (stop and clean up) and `.cancel()` (drop a pending scheduled run without disposing).
- `EffectOptions` -- optional `name` for debug output and `schedule` to route executions through an external clock (e.g. `requestAnimationFrame`), coalescing repeated triggers.
- `SignalOptions<T>` -- optional config with `equals` for custom equality (pass `() => false` to always notify).
- `ComputedOptions<T>` -- optional `name` and `equals`. `equals` decides when a recomputed value counts as unchanged.
- `Computation` -- internal interface for anything that tracks dependencies (`_stale()` + `dependencies`).
- `SignalNode` -- internal interface for anything that can be read and unsubscribed from (`_unsubscribe()`, `_refresh()`).

## How it works

**Dependency tracking.** A module-level `currentComputation` variable holds the active `Computation` (either a `ComputedImpl` or `EffectImpl`). When a signal's `.value` getter runs, it checks `currentComputation` and, if non-null, adds the computation to its subscriber set and adds itself to the computation's dependency set. This creates a bidirectional link.

**Cleanup on re-run.** Before each re-execution, both `ComputedImpl` and `EffectImpl` unsubscribe from all previous dependencies and clear their dependency set. The new execution then re-tracks only the dependencies actually read, which enables dynamic dependency graphs (e.g., conditional branches that read different signals).

**Marking (push).** Every computed and effect is `CLEAN`, `CHECK` (an ancestor changed; it may need to rerun) or `DIRTY` (a direct dependency changed). `SignalImpl.set()` checks equality, then marks each direct subscriber `DIRTY`. A computed that leaves `CLEAN` marks its own subscribers `CHECK`; one already stale stops there. Unscheduled effects that become stale join a queue; scheduled effects ask their scheduler for a run.

**Refreshing (pull).** Reading a stale computed, or running a queued effect, first refreshes it. A `CHECK` node refreshes its computed dependencies in read order and stops as soon as it becomes `DIRTY`; a `DIRTY` node recomputes. A recompute compares the new value with the previous one; an equal value is discarded in favour of the previous one, and only a changed value marks its subscribers `DIRTY`. A node that refreshes without becoming `DIRTY` returns to `CLEAN` without running.

**Flushing.** After marking, the write flushes the effect queue unless a `batch` is open or a flush is already running. Effects written to by other effects during the flush join the same queue. A scheduled effect refreshes when its scheduler fires, so a frame where nothing changed value skips the run. `Effect.execute()` forces a run; `Effect.cancel()` drops a pending scheduled run and settles the effect's dependencies, so later changes reach it again.

**Batching.** `batch()` increments a `batchDepth` counter and flushes when the outermost batch exits. Nested batches are supported via depth counting.

**React bridge.** `useSignalState` uses React's `useSyncExternalStore`. It creates an `effect` that reads `signal.value` (establishing tracking) and calls the store's `callback` on change. The snapshot function uses `.peek()` to avoid double-tracking.

## Workflow recipes

### Add a new reactive property to a manager class

1. Add a `#`-private field: `readonly #fieldName: WritableSignal<T>`. The private field and the public cell getter must have different names -- a same-named field and getter does not compile.
2. Initialize it in the constructor: `this.#fieldName = signal(initialValue)`.
3. Add a public getter for the snapshot value: `get fieldName(): T { return this.#fieldName.peek(); }`.
4. Add a public getter with the `Cell` suffix when callers need reactivity: `get fieldNameCell(): Signal<T> { return this.#fieldName; }` (see `Hover`'s `#entry` field and `entryCell` getter).
5. Write mutators that call `this.#fieldName.set(newValue)` or `.update(fn)`.

### Subscribe to a signal in a React component

1. Import `useSignalState` from `@shift/editor`.
2. Call `const value = useSignalState(someSignal)` in the component body.
3. The component re-renders when the signal changes.

### Run a side effect tied to component lifecycle

1. Import `useSignalEffect` from `@/hooks/useSignalEffect`.
2. Call `useSignalEffect(() => { someSignal.value; /* side effect */ })` inside the component. The effect auto-disposes on unmount.

### Read a signal imperatively (no tracking)

Use `.peek()` inside mutators or event handlers where you need the current value but do not want to establish a reactive dependency.

### Publish data that is mutated in place

Keep the mutable object in a plain field and pair it with a revision signal. Bump the revision after each change, and expose the data through a computed that tracks the revision and returns a value with a new identity (a fresh view or wrapper), never the same object:

```ts
import { computed, signal, track } from "../signal";
import { PackedArray } from "../../model/PackedArray";

export class PointValues {
  readonly #coordinates: PackedArray;
  readonly #revision = signal(0);
  readonly valuesCell = computed(() => {
    track(this.#revision);
    return this.#coordinates.view; // a new subarray each time
  });

  constructor(values: Float64Array) {
    this.#coordinates = new PackedArray(2, values);
  }

  move(index: number, x: number, y: number): void {
    this.#coordinates.setItem(index, [x, y]);
    this.#revision.update((revision) => revision + 1);
  }
}
```

For a stable owner that only needs to announce "something changed", expose the revision itself (see `FontStore.committedRevisionCell`). For an event stream, publish a new event object each time (see `FontStore.invalidGlyphsCell`). Avoid `{ equals: () => false }`: it works for a signal's direct readers, but any computed that passes the same object along will compare it as unchanged.

## Gotchas

- **Object mutation is invisible.** Mutating properties on a signal's current value does not trigger updates. You must `.set()` a new reference.
- **Unscheduled effects run synchronously.** Setting a signal inside an effect body can trigger other unscheduled effects immediately (unless inside a `batch`). Careless writes inside effects can cause cascading re-executions. Scheduled effects defer to their scheduler instead.
- **Computed marks eagerly, evaluates lazily.** When a computed's dependency changes, it marks its subscribers `CHECK` immediately, but it does not recompute until something reads it or refreshes through it.
- **A computed that returns the same object after an in-place change looks unchanged.** Its readers will not rerun. Return a new view, wrapper or revision instead (see "Publish data that is mutated in place").
- **A computed that builds a fresh object on every run gains nothing from the default equality.** Give it a structural `equals` (see `Scene`'s node-wise comparison) when readers should not rerun for an identical rebuild.
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
cd apps/desktop && pnpm test
```

## Related

- `Editor` -- primary consumer; derives `toolCell` from the active tool's state cell and owns cursor/view cells
- `Camera` -- uses `zoomCell`, pan cells, and affine transform cells
- `Hover` -- uses `entryCell` for hovered editor state
- `Selection` -- store-derived: `stateCell` and its id set are computeds over the `ShiftStore` cell; mutations write selection records into the store rather than setting local signals
- `FontStore` -- owns signal-backed renderer snapshots and canonical loaded glyph models
- `useSignalState` -- React bridge hook (in this module)
- `useSignalEffect` -- lifecycle-aware effect hook (in `@/hooks/useSignalEffect`)
- `WorkspaceEditCoordinator` -- uses signals for settled and commit lifecycle state
