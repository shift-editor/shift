---
name: signals
description: Canonical rules for writing and reviewing reactive code in Shift. Use whenever you add or change code that uses `signal`, `computed`, `effect`, `track`, `peek`, `untracked`, `batch`, `keyedCache`, or `useSignalState`; when you touch the model (`Font`, `Glyph`, `FontStore`, layers), node definitions, render passes, or text layout; and whenever a UI or canvas "doesn't update", updates late, or redraws too often.
---

# /signals — How reactive code is written in Shift

A reactive bug rarely throws. The canvas just stops updating, updates one step late, or redraws on every unrelated change. Each rule below exists because Shift shipped exactly that bug. How the library itself works (equality, laziness, batching, disposal) lives in `packages/editor/src/lib/signals/docs/DOCS.md`; this skill is about applying it.

## The rule

**Every value a reactive reader depends on must reach it through a signal it subscribes to, at the narrowest granularity that still works.**

If a reader can get a value without subscribing (a plain field, a `peek()`, a lookup that misses), it will not rerun when that value changes. If it subscribes to more than it needs, it reruns on changes it doesn't care about.

## Rules

### 1. Derived lookups are computed, never mirrored

A `Map` or `Set` that indexes reactive state must be a `computed` over its source signal, or an immutable collection held in a signal. Never a hand-maintained collection kept "in sync" next to a signal.

```ts
// Wrong: every reader must remember track(#layersCell); every writer must refill the map.
readonly #layersBySourceId = new Map<SourceId, GlyphLayer>();

// Right: reading it subscribes by construction.
readonly #layersBySourceIdCell = computed(
  () => new Map(this.#layersCell.value.map((layer) => [layer.sourceId, layer])),
);
```

Lint enforces this with `shift/no-mutable-collection-field`: mutating a collection field outside the constructor, in a file that uses signals, is an error unless the collection holds signals or the field carries `// non-reactive: <reason>`. Only annotate after checking the field is never read from a computed, effect, or render path.

_Origin:_ `Glyph` kept component glyphs in a plain `Map` mutated in place; render models never saw a base glyph arrive, so added components drew nothing (#453).

### 2. Subscribe as narrowly as the reader needs

- A collection that fills in over time (loaded glyphs, projections) gets **one signal per key**, created lazily on first lookup — see `FontStore.#projectionCells`. A single signal holding the whole map makes every reader rerun on every load and forces a copy per write.
- A computed that reads a coarse signal "just in case" reruns on every change to it. Read the specific cell.
- Walking every entry of a font (65k in large CJK fonts) inside an effect that fires on each load is a performance bug even when it is correct. Walk the changed or loaded subset.

_Origin:_ `FontStore.glyphForId` once tracked the whole loaded-glyph map, so the scene and text layout reran on every glyph load (#454).

### 3. `.value`, `track`, and `peek`

| Where                                                                           | Read with                        |
| ------------------------------------------------------------------------------- | -------------------------------- |
| Inside `computed` / `effect` bodies, value used                                 | `cell.value`                     |
| Inside a reactive body, value unused (invalidation only)                        | `track(cell)`                    |
| Callbacks invoked _from_ a computed (e.g. functions passed into a render model) | `track(cell)` then `cell.peek()` |
| Imperative code (event handlers, commands, tests)                               | `cell.peek()`                    |

Lint (`shift/no-reactive-value-outside-boundary`) rejects `.value` outside reactive boundaries, which is why callbacks use `track` + `peek`. A bare `peek()` in reactive code means "deliberately do not rerun on this"; leave a comment saying why, because it reads identically to the bug.

### 4. A miss must still subscribe, and something must load it

When a reactive lookup can miss (data not loaded yet), two things must be true:

1. The miss subscribes to something that fires when the data arrives — a per-key cell that starts `null`, not a plain `Map.get` that returns `undefined` and subscribes to nothing.
2. Something actually triggers the load. Returning an empty result and moving on leaves it empty forever.

_Origin:_ typing a character whose glyph wasn't loaded laid it out at advance 0 and never re-laid out (#454); a component whose base glyph was never loaded stayed outline-less because the model skipped it instead of loading it (#453).

### 5. Replace, don't mutate; don't set what didn't change

- Signals compare with `Object.is`. Mutating a value in place and re-setting the same reference notifies nobody. Build a new reference.
- Setting a new-but-equal value notifies everyone. When a write runs on a broad trigger (every directory change, every workspace echo), compare first and skip the set — e.g. `Glyph.replaceComponentGlyphs` skips unchanged sets so directory updates don't invalidate every render model.

### 6. Effects are for side effects

- Effects render, sync, and start work; derivations belong in `computed`.
- Don't write a signal an effect also reads unless the loop is intended and terminates.
- Async work started from an effect is fire-and-forget: wrap it in an `async` method with `try`/`catch` that logs, and call it with `void` (see `Font.#loadComponentGlyphs`).
- Render effects use `schedule` to coalesce to one frame; React uses `useSignalState(cell, { schedule: "frame" })` for high-frequency cells.

### 7. Lifetimes

Whoever creates a `computed` or `effect` disposes it. Disposing a computed silently orphans everything that reached its source _through_ it; if a subscriber can outlive the intermediate, give it a direct edge to the source (details in `signals/docs/DOCS.md`). Use `keyedCache` for per-key derived objects so identity is stable and old entries dispose.

### 8. There must be one signals runtime

Two copies of the signals module means two dependency trackers: computeds built with one never see signals from the other, and everything looks subscribed but never updates. In the desktop dev server this happened when workspace packages resolved through pnpm symlinks (#447; fixed by `resolve.preserveSymlinks: false` in `apps/desktop/vite.renderer.config.ts`). Any bundler or alias change for `@shift/*` packages must keep one real path per module.

## When the UI doesn't update

Work down this list before changing code:

1. **One runtime?** In dev, check the browser's loaded sources for `signals/signal.ts` twice (e.g. once under `node_modules/@shift/editor`). Symptom: many unrelated things stale at once.
2. **Is the value behind a signal?** Trace from the reader to the storage. A plain field, a `peek()`, or a mutated-in-place object anywhere on that path breaks it.
3. **Does the reader run inside a reactive boundary?** Code called outside `computed`/`effect` tracks nothing.
4. **On a miss, what does the reader subscribe to?** If nothing fires when the data arrives, it never recovers (rule 4).
5. **Is the data actually loaded?** Check the store, not the UI.
6. **Why did it (not) run?** Put `traceReactiveRun()` inside the suspect computed/effect to log which tracked ancestors changed; `signalDebug.dump(node)` prints its dependency graph.

## Testing reactive code

Reproduce with the object the UI actually holds. Get the live render model or layout **before** the change, subscribe an `effect` to it the way the renderer does, perform the change through the real editor (`TestEditor`, real engine), then assert on what the reader ends up seeing. Fetching a fresh object after the change hides exactly the bugs this skill is about.

```ts
const model = editor.sceneGlyphRenderModel!;
const seen: number[] = [];
const subscription = effect(() => seen.push(model.contoursCell.value.length));

await editor.addComponent(baseGlyphId);
subscription.dispose();

expect(model.contours).toHaveLength(1);
```

Reproduce the realistic precondition: data saved and reopened so it is _not_ already loaded (see `ComponentEditing.test.ts`). For state that arrives asynchronously after an edit settles, use `expect.poll`. Assert on final observable values, never on how many times something ran — see the `writing-tests` skill.

## Before you finish

- [ ] Every collection field in a signal-using class is derived, holds signals, or is annotated `// non-reactive:` with a verified reason.
- [ ] Every `peek()` inside reactive code is intentional and commented.
- [ ] Lookups that can miss subscribe to a per-key cell and trigger the load.
- [ ] No reader subscribes to a whole collection when it needs one entry.
- [ ] Writes on broad triggers skip unchanged values.
- [ ] Nothing walks every glyph in the font per event.
- [ ] A test holds the live object across the change.
