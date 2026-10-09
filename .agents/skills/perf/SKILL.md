---
name: perf
description: How to find and fix performance problems in Shift's desktop app. Use when something is slow, choppy, janky, or laggy (scrubbing, dragging, editing, undo, opening fonts), when profiling or measuring, when adding or reviewing perf tests, and before claiming a change made something faster.
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

A healthy weight scrub on Inter Italic (Ryzen 5 5500U, Linux): p99 frame ≈ 16.8 ms, about 60 component renders per commit, main thread about 25% busy. Use that as a reference for "fixed".

## 3. Backend: the workspace process and the store

Edits, undo, glyph loads, and atlas preparation run in the workspace utility process through the Rust bridge. `pnpm profile:desktop --scenario open` prints main's per-phase atlas timings (`SHIFT_PROFILE_SLUG_ATLAS`); `--scenario undo` times edit-coordinator round trips. `pnpm build` does not rebuild the native bridge — `profile:build` does, and a Rust change measured without it is measuring the old code.

A `.shift` document opens with a recovery overlay: every table is read through a temp view that `UNION ALL`s the recovery rows with the canonical rows, filtered by tombstones, replacement markers, and parent visibility (`crates/shift-store/src/recovery/views.rs`). SQLite pushes `WHERE` terms into those views, so a key lookup searches each arm by index; it does **not** push join terms. So in store queries:

- **Never join two store tables on a key.** Express the second table as `col IN (SELECT …)`. `referenced_glyph_ids_for_glyphs` took 117 ms as a join and 14 ms as an `IN` subquery on Inter; `dependent_glyph_ids_for_layers`, which runs after every edit, undo, and redo, took 172 ms and 8 ms.
- Compare a query against `main.<table>` to see what the overlay costs. A large gap means the view is being scanned rather than searched; `EXPLAIN QUERY PLAN` shows it as `CO-ROUTINE <view>` followed by `AUTOMATIC COVERING INDEX`.
- `nix develop --command sqlite3 -readonly <file>.shift` runs queries and `EXPLAIN QUERY PLAN` against a real document; the recovery views only exist inside the app's connection, so compare the canonical query there and the merged one through a store test.
- Store tests use canonical tables, so they will not catch this. Measure on a real document opened with recovery.

## 4. Prove it

- Rerun the exact same `profile:desktop` command and report before/after numbers in the commit message.
- A React re-render regression gets a budget in `apps/desktop/e2e/render-budget.spec.ts` (visual project, so it runs in CI without a GPU). It counts mean component renders per commit during a weight scrub and a marquee with the same counter as `profile:desktop` (`e2e/fixtures/renderCounter.mts`); a failure lists what started the renders. Budgets sit about 15% over the measured value, so a new subscription on those paths must raise one on purpose.
- If the problem can regress silently, add or extend a spec in `apps/desktop/e2e/perf.spec.ts` (`pnpm --filter @shift/desktop test:e2e:perf`, run through the `shift-remote-e2e` skill rather than on a user's desktop). It records p50/p95 against `perf-baseline.json`.
- Note in the commit which platform you measured on; Linux and Windows can be several times slower than macOS for the same code, so "fast on my Mac" proves nothing.
