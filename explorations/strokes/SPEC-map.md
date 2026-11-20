# Capability map — strokes exploration (`explore/strokes`)

**Last revised:** 2026-11-20 (rev 3 — local-first direction, icon-design pressure test)  
**Gated:** human reviews boundaries and build order before module specs, plans, or code.

This map scopes **what [ROADMAP.md](./ROADMAP.md) calls next** after CP0 and A2.1–A2.2 on branch.

## Direction (set by Tasos, 2026-11-20)

1. **Local first, socialise later.** Build the feature locally, play with it, check it fits the product. Only then message Kostya, open the umbrella issue and start socialising. No external sign-off blocks local work.
2. **Essential UI now.** Commands and essential (unpolished) UI are in scope so the feature is playable. Tasos cleans up and optimises the UI afterwards; nothing here is final chrome.
3. **No silent failures.** An action that cannot apply is prevented where it is chosen (disabled control with a reason). Where the surface cannot know in advance (the native app menu), the command surfaces a notification. Silently doing nothing is never acceptable.
4. **WYSIWYG, real time.** The canvas shows the computed stroke while editing and dragging, not only after commit. This is a requirement on every module, not a later polish pass.
5. **Nib is parked, not dropped.** Nib work (Stream B) becomes tangible once constant-width strokes are solid.
6. **Lean.** The map changes only when progress or new requirements demand it.

## What changed from rev 1

| Rev 1                                                                   | Rev 2                                                                               | Why                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `a-stroke-commands` and `a-stroke-panel` were "Later, after Kostya ack" | Now in the map, first in build order                                                | Direction 1 and 2: the feature must be playable locally |
| `a-cp1-gate` was a pre-UI checkpoint                                    | Renamed `a-local-signoff`, runs **after** local play                                | Direction 1                                             |
| `a-stroke-preview` was "parallel, polish"                               | Promoted to a requirement of commands and panel; draft-drag parity is the hard part | Direction 4                                             |
| `f0-stroke-types`, `f0-solver-nib-sweep` were first in order            | Parked, specs kept as drafts                                                        | Direction 5; constant-width needs no `NibSample`        |

## Modules

| Module id               | Responsibility                                                                                                                                                                                      | ROADMAP anchor       | Depends on                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `a-stroke-commands`     | Intents reachable from the editor: typed layer methods, `glyph.stroke.*` commands, one shared availability function (enabled or disabled-with-reason), a missing "remove dynamic stroke" intent     | A3.1 (command half)  | A1, A2 (done)                                             |
| `a-stroke-preview`      | Real-time WYSIWYG preview: always on for dynamic strokes, revision-keyed so it is not re-solved every frame, correct while dragging (Rust-owned preview source, no TS solver)                       | A3.2                 | A2.1, WASM `stroke_outline_previews` (done)               |
| `a-stroke-panel`        | Essential UI per [UX-spec.md](./UX-spec.md): Glyph → Stroke menu, right-sidebar Stroke section, Apply / Expand dialogs, canvas context menu. Unpolished by design                                   | A3.1 (UI half)       | `a-stroke-commands`, `a-stroke-preview`                   |
| `a-stroke-interp-spike` | **Time-boxed spike (R-interp):** one glyph, two masters, dynamic stroke at two widths; compare interpolate-then-expand with expand-then-interpolate. Output is a decision, not shipped code         | A3 / B5 gap          | `a-stroke-commands` (to apply strokes), WASM preview read |
| `a-stroke-presets`      | Named stroke widths (Pierre-style tokens): font-level `StrokeStylePreset` under `com.shift.strokeStyles`, referenced from the layer lib, sidebar preset picker. **Split out of F0.2**; no nib types | F0.2 (presets half)  | `a-stroke-panel`                                          |
| `a-local-signoff`       | **Checkpoint, not code:** Tasos plays with it, decides it fits; then umbrella issue, Kostya message, socialising                                                                                    | CP1, alignment gates | `a-stroke-panel`                                          |
| `f0-stroke-types`       | **Parked, nib half only.** F0.2 `NibSample` and `NibTrack`. The presets half moved to `a-stroke-presets`                                                                                            | F0.2                 | —                                                         |
| `f0-solver-nib-sweep`   | **Parked.** F0.3 `NibSweep`, unified `outline(skeleton, track, style)`                                                                                                                              | F0.3                 | `f0-stroke-types`                                         |

**Later (not in this map):** Stream **B** (nib UI), **C** (pen) and **D** (SVG export) remain ROADMAP placeholders. Also later: optical breaks, tapered junctions, a minimum-gap check, a stroke consistency report (see [UX-spec.md](./UX-spec.md) Design pressure test).

## Risks carried by the map

| ID         | Risk                                                                                     | Module that retires it  |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| R-interp   | Per-master stroke widths may not interpolate once expanded (untested)                    | `a-stroke-interp-spike` |
| R-presets  | No named widths; typing values each time                                                 | `a-stroke-presets`      |
| R-taper    | Constant-width solver cannot taper; F0.3 must keep per-point width open                  | F0.3 note, parked       |
| R-preview  | Preview must be real time and correct during drag, and visible at real size in text runs | `a-stroke-preview`      |
| R-silent   | A command that cannot run must say why                                                   | `a-stroke-commands`     |
| R-ui-drift | Essential UI is unpolished by design and will be reshaped                                | `a-local-signoff`       |

## Build order

```
a-stroke-commands ──┐
                    ├──► a-stroke-panel ──► a-local-signoff
a-stroke-preview  ──┘
                    └──► a-stroke-presets      (after panel; extends the width row)

a-stroke-commands ──► a-stroke-interp-spike    (decision before dynamic strokes ship in a variable font)

f0-stroke-types ──► f0-solver-nib-sweep      (parked; resumes after local sign-off)
```

1. **`a-stroke-commands`** — small, unblocks the panel, and makes the intents callable from the editor and from tests.
2. **`a-stroke-preview`** — starts alongside commands (only needs A2 and the existing WASM read). **Riskiest module:** draft-drag parity needs a Rust-owned preview source. Expect a short spike before its spec is final.
3. **`a-stroke-panel`** — needs both: sidebar edits must recompute live, and every control calls a command.
4. **`a-local-signoff`** — human milestone.

## Module specs

| Module id               | Spec file                                                | Status                                                          |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `a-stroke-commands`     | [SPEC-a-stroke-commands.md](./SPEC-a-stroke-commands.md) | Approved; implemented locally, awaiting local sign-off          |
| `a-stroke-preview`      | _(not written)_                                          | Next after commands spec approval; may need a spike             |
| `a-stroke-panel`        | _(not written)_                                          | After commands and preview                                      |
| `a-stroke-interp-spike` | _(not written)_                                          | Short spike; can start once commands exist                      |
| `a-stroke-presets`      | _(not written)_                                          | After the panel. Takes the presets half of the parked F0.2 spec |
| `f0-stroke-types`       | [SPEC-f0-stroke-types.md](./SPEC-f0-stroke-types.md)     | Parked draft                                                    |
| `f0-solver-nib-sweep`   | _(not written)_                                          | Parked                                                          |
