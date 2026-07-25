# Glyph Pipeline Performance — Lessons and Instrumentation

Distilled from the 2026-07 glyph grid investigation (branch `perf/glyph-grid-loading`,
overhaul in `32b5b6b5`). Measured baselines live in the project vault:
`Reference - Glyph Pipeline Performance Baselines 2026-07`.

## Reconstructing the instrumentation

The full measurement chain was removed in **`f6287fde`**. To benchmark again:

```sh
git revert --no-commit f6287fde   # restores every probe; drop the revert when done
pnpm build:native                 # the bridge timers are Rust-side
```

Probes and where their output lands:

| Tag                          | Layer                    | Measures                                             | Output    |
| ---------------------------- | ------------------------ | ---------------------------------------------------- | --------- |
| `[bridge] get_glyph_snapshots` | Rust bridge            | total / projection (layer, fallback, master) / layers / convert | app log\* |
| `[workspace-host] …`         | utility handlers         | queueWaitMs vs execMs per RPC; `payloadKb` probe on snapshots ≥50 | app log\* |
| `[glyph-rpc]`                | WorkspaceEditCoordinator | coordinator queue wait vs wire time                  | devtools  |
| `[glyph-apply]`              | FontStore                | snapshot → store hydration                           | devtools  |
| `[glyph-read]` / `[glyph-load]` | Font                  | read rounds; read / assemble / store-update split    | devtools  |
| `[glyph-frame]`              | grid frame cell          | previews built + build ms                            | devtools  |
| `[glyph-blank]`              | GlyphGrid                | data-blank episodes: duration + max missing cells    | devtools  |

\* `~/Library/Logs/Shift/main.log` — utility stdout/stderr are piped there, including
Rust `eprintln!`. Renderer console lines are devtools-only.

Reading the pipeline end to end:

```text
[glyph-read] roundsMs ≈ [glyph-rpc] queueMs
                       + ([glyph-rpc] rpcMs − [workspace-host] execMs)   ← wire/serialize
                       + [glyph-apply] applyMs
[glyph-grid] − [glyph-read] and [glyph-frame]                            ← main-thread render
```

Diagnose in this order: utility `queueWaitMs` (serialization behind other ops) →
bridge phase split (compute) → rpc−exec gap (payload weight) → apply (store) →
frame build (render). One layer will dominate; fix that one and re-measure.

## Rust lessons

- **Never do location-bound geometry work while building a location-independent
  artifact.** `glyph_projection` once detected component divergence by fully
  resolving every contour of the component closure at every master — 86 % of all
  read time — when the structural comparison needed no geometry at all. The
  convenient existing resolver was the trap: it produced something the comparator
  accepted, so nobody chose the O(masters × closure) cost — it arrived free with
  the call. Invariants I1–I4 in the vault projection ticket exist to block this
  class; enforce them with work counters (count real operations in tests), not
  wall-clock benchmarks.
- **Structure comparisons must respect resolved identity.** Interpolation output
  carries the reference layer's component ids at every compatible master.
  Comparing authored per-master layers instead produces false divergence — the
  characterization tests in `projection.rs` pin this.
- **Watch for per-call rebuilds of derivable state.** `resolved_layer_at`
  reconstructed the whole layer projection (interpolation model included) on
  every call, per glyph, per location, recursively through components.
- Napi conversion and layer copies were negligible throughout (≤4 ms per
  300-glyph batch). Measure before blaming serialization.

## TypeScript / renderer lessons

- **Costs that grow with session age are the worst class of bug.** The glyph
  object index was rebuilt over *all resident layers* on every snapshot apply:
  27 ms → 122 ms as residency accumulated. Fix: derive it as a lazy tracked
  `computed` — invalidation becomes the signal graph's job, and there is no
  hand-rolled invalidation protocol to get wrong. When a computed's dependency
  set is dynamic (cells created lazily), give the *set itself* a version signal.
- **Never queue obsolete work.** FIFO read queues turned scroll bursts into
  multi-second pile-ups; the landing window waited behind every window scrolled
  past. Latest-wins scheduling (at most one in flight, only the newest next) and
  settle-gating heavy loads (models only after 120 ms of stillness) removed the
  entire regime.
- **Don't double-serialize.** The read path awaited `settled()` (full queue
  drain, reads included) on top of `#withFlush` (which already orders reads
  behind writes). Pure additive latency.
- **Instrumentation can become the bottleneck.** A probe reading
  `scrollTop`/`clientHeight` in a post-commit effect forced synchronous layout
  over a dirty 360-cell DOM (~185 ms/tick) and poisoned every other layout read,
  including the virtualizer's own. Also: publishing a growing `Map` by copy per
  chunk is O(n²) across a warm-up — publish a version stamp over shared
  structure instead.
- **All-or-nothing render gates amplify partial data.** A row that returned
  `null` when any single cell lacked a preview turned one cold glyph into ten
  blank cells; the frame cell that returned an empty map when any id was missing
  blanked the entire grid. Present what is ready; gate only the *swap* of whole
  windows (atomic frames), never the individual paint.
- **Presentation guarantees must not depend on the main thread.** The rAF-driven
  pinned frame was starved by exactly the saturation it existed to mask. CSS
  `position: sticky` with negative offsets (Pierre's inverse-sticky: strut +
  sticky block inside the full-height spacer) is compositor-enforced — blank
  scroll regions become impossible rather than unlikely.
- **Memoization needs identity discipline.** Rebuilding preview wrapper objects
  and metrics per tick defeats `React.memo`; compare by content where the
  underlying values are cached (svg strings compare by reference), and stabilize
  object identities (`useMemo`) feeding comparators.
- **Data residency is what makes scrolling "fly".** Fetch-per-window steps;
  resident previews stream. Cheap location-resolved previews (bridge-printed
  svg + advance, 5–15× lighter than snapshots) under a byte-budgeted LRU
  (`GlyphPreviewCache`) with viewport-outward warm-up is the pattern.

## Process lessons

- Instrument every layer before optimizing any; the bottleneck moved four times
  (Rust compute → coordinator queueing → store accretion → DOM/commit cost), and
  each move was only visible because the adjacent layers were already measured.
- Characterization tests written *before* a refactor catch the subtle contract
  (the component-id identity bug surfaced on the first run).
- Dev-build numbers are 3–5× inflated; confirm on a production build before
  concluding more surgery is needed.
