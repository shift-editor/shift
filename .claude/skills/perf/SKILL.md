---
name: perf
description: How to find and fix performance problems in Shift's desktop app and its Rust/WebAssembly engine. Use when something is slow, choppy, janky, or laggy (scrubbing, dragging, editing, undo, opening fonts), when an engine, store or WASM boundary change could cost time or memory on large fonts, when profiling or measuring, when adding or reviewing perf tests, and before claiming a change made something faster.
---

# /perf — Measuring and fixing slowness in Shift

Measure the build users run, find what started the work, fix that, and measure again with the same command. A guess that "this looks expensive" has been wrong more often than right here; a number with a cause attached has not.

## 1. Measure a packaged production build

Never draw conclusions from `pnpm dev`. React's development build adds `jsxDEV`, prop validation, and render logging that made up about half of every dev profile and pointed at the wrong code.

```sh
pnpm profile:build      # native bridge (release) + renderer minified like a release, with source maps and component names (~1 min warm)
pnpm profile:desktop --font <path> [--glyph A] [--scenario scrub] [--axis Weight] [--seconds 8] [--cpu out.cpuprofile]
```

`profile:desktop` launches the packaged app with a throwaway profile, opens the font and glyph, drives the scenario with real pointer input, and prints:

- **Frame times** (p50/p90/p99, frames over 33 ms) — the number the user feels.
- **React renders per commit**, and for each re-rendered subtree the component and the hook slot or context that started it. This is what tells you what to fix.
- **A source-mapped CPU profile** — busy time, top self time, top inclusive time in Shift code. Open the saved `.cpuprofile` in Chrome DevTools for flame charts.

Notes:

- The packaged app is in `apps/desktop/out/<platform>-<arch>/` (`linux-unpacked/shift` on Linux). Older `out/Shift-*` directories are stale Electron Forge output; ignore them.
- Packaged builds disable Node's inspector fuse, so Playwright's `_electron.launch` cannot attach. The script uses Chromium's `--remote-debugging-port` and `connectOverCDP` instead.
- On a remote or headless Linux session the app needs the desktop's environment (`DISPLAY`/`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`), and must not inherit a Nix `LD_LIBRARY_PATH`.
- Linux needs Chromium's `Vulkan` feature for WebGPU; without a GPU adapter the glyph grid falls back and the numbers mean nothing.
- Add a scenario to `scripts/profile-desktop.mjs` rather than writing a one-off script, so the next person can rerun your measurement.

## 2. Frontend: find what started each render

Read the "Renders started by" list top-down:

- `hook#N` — hook slot N in that component changed. `useSignalState` (and `useSyncExternalStore`) take two slots each, `useContext` takes none, so count `use*` calls to map a slot to a line.
- `context {…}` — a context value changed; the keys identify which one. A context built from a high-frequency signal re-renders every consumer on every change.
- A component starting the same number of renders as there were commits is subscribed to the thing being scrubbed or dragged. Ask whether it shows that value. If not, it's the bug.

Patterns that caused real regressions (rules in `/signals`):

- **Re-doing work on every change that a signal already tracks** — the catalog re-opened the editor's glyph on every location change although its render model follows the location signal. This re-rendered the whole editor.
- **New-but-equal values** — `new Set(...)` written each step to a signal compared by `Object.is`. Give the signal an `equals`.
- **Wide contexts** — `Editor` read the catalog context just for `openedGlyph`. Narrow it to its own context or read the specific cell.
- **Hidden but mounted views** — the home grid stays mounted behind the editor to keep its WebGPU atlas, and kept re-laying out on every scrub step. Hold its inputs while hidden.
- **Subscribing for a value used only on an event** — read `cell.peek()` in the handler.
- **Main-process pushes that resend unchanged data** — the menu bar was re-sent after every command. Compare before sending.
- **Closed but mounted dialogs** — the Add Component picker stayed mounted while closed, subscribed to every glyph record, and cost about 1 s of a scrub profile with 93 long tasks. Mount a dialog's contents only while it is open.
- **Scanning for one item** — moving points scanned each contour for each id, and validating a 10K-point batch took 21 s. Look items up through a derived id → index map and validate a batch in one pass (#371, #670).
- **Startup work for one panel** — 17 MB of glyph-info JSON was parsed in every window at startup. Loaded lazily, the renderer bundle went from 15.8 to 6.6 MB (#565).
- **Per-item canvas state** — a 10K-character text run made 29,665 save/restore calls per frame while the GPU took ~0.5 ms; the cost was the main-thread calls. Draw repeated glyphs inside one canvas state (#668).
- **Costs that grow with session age** — an index rebuilt over everything loaded got slower the longer the app ran. Derive it with `computed` from what is in view.

A healthy weight scrub on Inter Italic (Ryzen 5 5500U, Linux): p99 frame ≈ 16.8 ms, about 60 component renders per commit, main thread about 25% busy. Use that as a reference for "fixed".

## 3. Backend: the workspace process and the store

Edits, undo, glyph loads, and atlas preparation run in the workspace utility process through the Rust bridge. `pnpm profile:desktop --scenario open` prints main's per-phase atlas timings (`SHIFT_PROFILE_SLUG_ATLAS`); `--scenario undo` times edit-coordinator round trips. `pnpm build` does not rebuild the native bridge — `profile:build` does, and a Rust change measured without it is measuring the old code.

A `.shift` document opens with a recovery overlay: every table is read through a temp view that `UNION ALL`s the recovery rows with the canonical rows, filtered by tombstones, replacement markers, and parent visibility (`crates/shift-store/src/recovery/views.rs`). SQLite pushes `WHERE` terms into those views, so a key lookup searches each arm by index; it does **not** push join terms. So in store queries:

- **Never join two store tables on a key.** Express the second table as `col IN (SELECT …)`. `referenced_glyph_ids_for_glyphs` took 117 ms as a join and 14 ms as an `IN` subquery on Inter; `dependent_glyph_ids_for_layers`, which runs after every edit, undo, and redo, took 172 ms and 8 ms.
- Compare a query against `main.<table>` to see what the overlay costs. A large gap means the view is being scanned rather than searched; `EXPLAIN QUERY PLAN` shows it as `CO-ROUTINE <view>` followed by `AUTOMATIC COVERING INDEX`.
- `nix develop --command sqlite3 -readonly <file>.shift` runs queries and `EXPLAIN QUERY PLAN` against a real document; the recovery views only exist inside the app's connection, so compare the canonical query there and the merged one through a store test.
- Store tests use canonical tables, so they will not catch this. Measure on a real document opened with recovery.

Other store and workspace costs that were real:

- **Several writes, one transaction.** Creating a document ran 31 `CREATE`s as separate transactions, about 134 fsyncs: ~660 ms on ext4, against 45–54 ms as one transaction (#678). tmpfs and CI hide fsync cost, so measure on a real disk.
- **Integrity checks once per open.** `PRAGMA integrity_check` plus `foreign_key_check` cost ~345 ms on Inter and ran three times per open (#565). Keep them off read-only paths such as identity inspection.
- **Background work on the workspace queue loads only what it needs.** The recent-file thumbnail decoded every layer (~1 s on Inter Italic), and glyph loads and atlas pages waited behind it (#565).
- **Undo and redo re-index only what they touch.** Rebuilding the whole font index made undo/redo 418/463 ms; re-indexing touched glyphs made them ~53/~60 ms (#565).
- **Encode outside the transaction, upsert only what changed.** Encoding payloads in parallel before the transaction and upserting only changed layers took a 1,000-glyph change set from 1.0–1.2 s to about 0.3 s.

## 4. Engine: an edit costs what it touches

Rust engine costs that scale with the font never show on small fonts. One point move cost 0.45 ms on MutatorSans and 115 ms on Noto Sans CJK SC (65.5k glyphs), and 0.23 ms once fixed. So:

- **Measure edits on Noto Sans CJK SC as well as Inter.** A cost per glyph, id, layer or kerning pair is invisible below ~5k glyphs.
- **Never copy, sweep or rehash the whole font per edit.** Each of these was a real cost on CJK: cloning `FontState` and its id sets, the glyph list (65k entries), kerning (18 ms at 280k pairs; 0.09 ms once persistent), and the residency sweep over every unloaded layer after each commit. Shared state that edits replace piecewise belongs in persistent structures (`Arc` values, persistent maps and vectors), and sweeps run only when an edit can change what they check.
- **Bulk paths diff, they don't rehash.** Replacing 1,000 glyphs re-hashed every point id of each (SipHash was hot in `perf`): 305–464 ms, against 30 ms when unchanged id lists are skipped. Watch for eager arguments too: an `unwrap_or(...)` ran `SELECT COUNT(*)` once per replaced glyph.
- **Renumber once per batch.** Deleting 1,000 glyphs from 65k one at a time took 6.6 s; as one batch, rebuilding and renumbering once, 28 ms.
- **Above roughly 10k changed glyphs, reload rather than patch.** Patching costs ~0.27 ms per changed glyph and a full reload ~2.8 s on CJK; the crossover is approximate.
- **Re-indexing one glyph scales with its points.** After the fixes above, undo+redo still took ~11 ms on a fully loaded font and 34 ms on a 20k-point glyph, so measure a large glyph as well as a large font.
- **Location-independent work never resolves geometry per master.** Comparing component structure by resolving geometry at every master made a 306-glyph read take 2,160 ms instead of 245 ms (#161); sharing one projection set per Slug compilation made Fraunces 5.4× faster (#171). Guard these with work counters in tests, not wall-clock times.
- **Engine results are deterministic.** Native and wasm32 trig differed on 4% of values (up to 396 ulp) until `libm`, and change-set order followed `HashMap` seeds, so 51% of anchor edits diverged between two engines. `clippy::iter_over_hash_type` and `disallowed-methods` enforce this.
- **Echoes carry only what changed.** Resending all 65,535 glyph records after a structural edit made Reverse Contour take 807 ms to confirm, against 39 ms without them.
- **Don't fsync per file when the store holds the truth.** A full CJK write took 22 s with per-file fsync and 4.7 s with a marker and one barrier. macOS is unmeasured.
- **Shaping updates are incremental.** Re-registering the CJK cmap costs 16 ms and 700 KB, so send changed pairs. Building the shaper font loads every layer: the first `shape` took 35 ms on Inter and 578 ms on Source Han Sans JP.

`cargo test --release -p shift-font -- perf_mark` prints release timings for whole-font operations on synthetic fonts up to CJK size. Run it before and after an engine change.

### WebAssembly

- **Cross the boundary once per edit, with flat values.** 10k points cost 7.5 ms as JS objects and 0.07 ms as a `Float64Array`. Send structure only when it changed, and never call back into JS per item: in the layout-engine spike, compute ran ~1.4× native but 11k JS callbacks took 438 ms.
- **Keep residency lazy.** Opening Noto CJK in the engine took 365 ms and 92 MB lazily, and 11 s and 1.31 GB fully loaded.
- **Measure the renderer's working set, not just the WASM heap.** The renderer grew 133 MB around an 85 MB engine heap.
- Shaping proof text in the editor takes 17–411 µs, against 80–2,943 µs through the workspace round trip (#683). Synchronous WASM calls beat IPC for small, frequent work.
- **Module size and startup are costs.** The shaping module is 0.8 MB and starts in ~5 ms (#683); the edit-engine spike module was 1.69 MB (0.55 MB gzip) and ~8 ms. Record both when a crate joins a module, and load large modules lazily.
- **A Rust panic kills the instance.** Recovery with `--experimental-reset-state-function` and a reload took ~3 ms in the spike; keep that path.
- **Serialize with named fields.** Only named MessagePack round-tripped engine snapshots exactly; `serde(flatten)` buffered numbers untyped and turned `-0` into `0`.

### Across processes

The crossing is cheap; what it carries is not. NAPI conversion measured ≤4 ms per 300-glyph batch (#161), but a full 50K-point snapshot sync took 96 ms (#35). A warm Electron utility-process hop costs ~0.1–0.4 ms, and the first call after spawn ~100 ms.

- **Return deltas.** Resizing one text block returned 0.2 KiB in a 0.7 ms round trip; reshaping all 40 blocks returned 194 KiB in 13–14.6 ms.
- **Keep one request in flight and replace the pending one.** Sending every 835.8 KiB request at 240 Hz queued 78 requests and reached 549.9 ms p95; latest-only coalescing held it to 17.8 ms.
- **Interactive work never shares a serial queue with persistence or compilation.** 25 ms of competing work every tenth request pushed p95 to ~26 ms even with coalescing.

## 5. Prove it

- Rerun the exact same `profile:desktop` command and report before/after numbers in the commit message.
- A React re-render regression gets a budget in `apps/desktop/e2e/render-budget.spec.ts` (visual project, so it runs in CI without a GPU). It counts mean component renders per commit during a weight scrub and a marquee with the same counter as `profile:desktop` (`e2e/fixtures/renderCounter.mts`); a failure lists what started the renders. Budgets sit about 15% over the measured value, so a new subscription on those paths must raise one on purpose.
- If the problem can regress silently, add or extend a spec in `apps/desktop/e2e/perf.spec.ts` (`pnpm --filter @shift/desktop test:e2e:perf`, run through the `shift-remote-e2e` skill rather than on a user's desktop). It records p50/p95 against `perf-baseline.json`.
- Moving a rule between TypeScript and `@shift/wasm`, or keeping one in TypeScript for speed, needs both paths measured on the same workload, including packing and unpacking at the boundary (see "Choosing a route" in `crates/shift-wasm/docs/DOCS.md`).
- An engine edit-cost regression gets a release budget in shift-font's `perf_mark` tests, measured on the CJK-sized mark. Assert Rust budgets only in release builds: a debug build ran one rename in 1.01 s against 53 ms optimised (#631).
- Run untimed warm-up frames before timing. The first 50K-point frames on CI took 98, 56, 68 and 64 ms before settling near 35 ms, and with 30 samples p95 is the second-slowest frame (#670). Hosted-runner GC pauses of 25–75 ms (against ~3 ms locally) need the same allowance.
- Report the heaviest frame's main-thread time, not time to idle, which counts vsyncs (#668).
- When wall-clock noise is larger than the change, report the CPU-profile time of the code you changed (#568).
- Note in the commit which platform you measured on; Linux and Windows can be several times slower than macOS for the same code, so "fast on my Mac" proves nothing.
