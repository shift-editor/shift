# Plan: `a-stroke-metrics`

**Spec:** [SPEC-a-stroke-metrics.md](./SPEC-a-stroke-metrics.md) (rev 2, decided)  
**Branch:** `explore/strokes` (local only)  
**Status:** planned, not started. Next after this plan: grill [SPEC-a-stroke-snap.md](./SPEC-a-stroke-snap.md), then `a-stroke-export`.

## Overview

A stroked glyph is measured by its ink. Rust computes one extent per layer under a named measure (skeleton or ink), every Rust reader (linked metrics, Set Sidebearings) and every TypeScript reader (inspector, spacing tool, bounds fields, transform edge-keeping) reads that one answer, a per-font switch opts out, and a re-apply action fixes a font left mixed by the switch. The numeric bounds become editable against the ink.

## Architecture decisions

- **One extent, one function.** `Measure::{Skeleton, Ink}` over a layer returns bounds, and LSB, RSB and measures at a height derive from it. No reader keeps its own copy.
- **Rust first, behind the existing evaluator.** `MetricsKeyEvaluator::measure` is the choke point for linked metrics and `SetSidebearings`. Making it measure-aware covers both with one change; TypeScript follows through a wasm read.
- **Ink has its own cache in `shift-font`.** It is content-keyed like `StrokeOutlineCache` (path, style, tolerance), so it needs no invalidation. The window engine's cache stays separate; the duplicate solve is accepted and measured in M2.
- **Whole-layer fallback.** Any contour failure makes the layer measure the skeleton, with the reason; there is no partial ink.
- **The switch is a typed font-lib key** with its own intent and a change-impact flag, like `com.shift.languages`. It touches no layer.
- **The TS skeleton measure stays** in `LayerBuffers` for per-frame drags with no stroke; where a layer has a dynamic stroke, the effective cell reads Rust's extent (which follows `previewed`).
- **Re-apply is `follow_linked_metrics` with a scope**, one intent, one undo step.
- **Bounds edits go through Rust for resizes.** A move is `typed - current`, exact. A resize is fitted in Rust and verified; TypeScript does not fit.

## Dependency graph

```
M1 extent (Rust) ─► M2 ink cache ─┬─► M4 linked metrics + SetSidebearings read it
                                  │
M3 the switch (Rust) ─────────────┤
                                  ├─► M5 re-apply (Rust)
                                  │
                                  └─► M6 wasm read + TS cells ─► M7 TS readers ─► M8 Glyph section UI
                                                                          │
                                         M9a fit spike (Rust) ─► M9 ink bounds fields ─► M10 verify, docs, Checkpoint E
```

M1, M3 can start together. M9a (the spike) needs only M1 and can run any time after it.

## Tasks

### Phase 1: Rust, no UI

- [x] **M1. Extent of a layer under a measure** (M)
  - Acceptance: `Measure::Skeleton` equals today's `resolved_contours_bbox`. `Measure::Ink` replaces each dynamic skeleton by its solved outline and takes the bounds; plain contours are unchanged. A component's ink is the base glyph's ink with the component's transform applied to the outline points, bounds after. The result carries which measure was used and, on a fallback, the reason; any contour failure makes the whole layer fall back. A layer with no dynamic stroke returns the same extent under both.
  - Verify: `cargo test -p shift-font`; tests first: 40-unit stem (LSB 80), closed ring, open contour with a square cap, rotated component (outline bounds, not box bounds), a partly failed layer, a plain layer. Mutation check on the measure choice.
  - Files: `shift-font/src/stroke/ink.rs` (new), `stroke/live_stroke.rs` (outline extents with positions), `stroke/mod.rs`.
- [x] **M2. Own ink cache** (S)
  - Acceptance: a second read of an unchanged layer solves nothing; a changed style or point solves again; entries are bounded; the cache lives where linked metrics run (the workspace `Font`), not in the window engine.
  - Verify: `cargo test -p shift-font` with a solve counter, as the preview cache's tests do. Measure the cost of one ink read on a 600-point glyph and record it in the results.
  - Files: `stroke/ink.rs`, `stroke/solve_cache.rs` if the type is reused.
- [x] **M3. The switch** (S)
  - Acceptance: a typed font-lib key and accessor; `SetIgnoreStroke` is one undo step and changes no layer; a font without the key reads as "include"; the key survives save and reopen; changing it flags the change so readers rerun; it is never written into export.
  - Verify: `cargo test -p shift-font`; a store round trip test; a test that the export path does not read it.
  - Files: `shift-font/src/ir/font.rs`, `intents.rs`, `changes.rs`, `intents/font_intents.rs`; `shift-store` if the lib key needs a schema entry.
- [x] **M4. Linked metrics and Set Sidebearings read the measure** (M)
  - Acceptance: `MetricsKeyEvaluator::measure` and `Font::sidebearing` use the font's current measure. A key `=A` follows A's ink after A's stroke width changes; a key at a height reads the ink crossing; flipping the switch re-applies nothing (no layer changes); `SetSidebearings` on a stroked glyph lands the ink edge.
  - Verify: `cargo test -p shift-font` incl. the existing `linked_metrics` suites unchanged; new tests for each acceptance line.
  - Files: `linked_metrics/measure.rs`, `linked_metrics/evaluate.rs`, `intents/glyph_intents.rs`.
- [x] **M5. Re-apply linked metrics** (S)
  - Acceptance: `ReapplyLinkedMetrics { scope }` with `Glyph { glyph, source }` and `Font`; "glyph" applies that glyph's keys and keys that read it; "font" applies every key in every source; one undo step; a scope with nothing to apply reports it (so the UI can disable with a reason).
  - Verify: `cargo test -p shift-font`; intent round trip through undo and redo.
  - Files: `linked_metrics/apply.rs`, `intents.rs`.

### Phase 2: Reads

- [x] **M6. Wasm read and TypeScript cells** (M)
  - Acceptance: `layer_extent(layer)` follows `previewed`, returns skeleton, ink and which one is in effect and why; `Font.layerExtentCell(layerId)` re-derives on `revision("layers")` and on the switch; `Glyph`'s effective sidebearings cell uses it when the layer has a dynamic stroke and `LayerBuffers` otherwise; a layer between masters or with a failed solve reads skeleton with a reason.
  - Verify: `cargo test -p shift-wasm --features engine`; `pnpm build:wasm`; editor tests for the cell (identity between edits, new value after a style change, the reason on a collapsed skeleton).
  - Files: `shift-wasm/src/engine_reads.rs`, `stroke_preview.rs` or a sibling, `packages/editor/src/lib/{wasm,engine,model}/*`, `types/font.ts`.
- [x] **M7. Every TypeScript reader reads the effective cell** (M)
  - Acceptance: the audit in the spec is closed. Inspector, `setLeftSidebearing` / `setRightSidebearing`, `RunSpacing` / `SnapTargets` / `SpacingGapOverlay`, `GlyphTransformEdit`'s kept edges, and the multi-glyph edit in `Font` read the effective values; the guide lines (`Guides.ts`) draw the ink edges; during a drag each reads the ink of the frame.
  - Verify: one behaviour test per reader through `TestEditor`; a drag test (inspector value follows the previewed ink; after release it equals the last frame).
  - Files: the readers above.

### Phase 3: UI

- [x] **M8. Glyph section: the switch, the label, re-apply** (M)
  - Acceptance: "Include stroke" beside LSB and RSB for a glyph with a dynamic stroke, wired to M3; the secondary "skeleton N" label when the measures differ; a fallback shows the skeleton value, the label and a reason tooltip; a refresh dropdown in `glyphHeading` with "This glyph" and "Whole font" (M5), each disabled with its reason; refusals notify.
  - Verify: component and behaviour tests; `pnpm test:desktop`. Checkpoint E (Tasos by hand).
  - Files: `packages/editor/src/ui/GlyphSidebar.tsx`, `useGlyphMetrics.ts`, the desktop host's `glyphHeading` slot, `rendererCommands.ts` if a command id is needed.
- [x] **M9a. Spike: fit an ink edge** (S, time-boxed)
  - Acceptance: a Rust function scales a skeleton about the opposite edge until the ink edge lands within the solve tolerance, or reports why it cannot. Results recorded: iterations, failure cases (caps, miters, inner offsets, sizes below the stroke width), and whether a root find is reliable.
  - Verify: `cargo test -p shift-font`; a table of cases in the results.
  - Files: `stroke/ink_fit.rs`.
- [x] **M9. Ink bounds fields** (M)
  - Acceptance: x, y, width and height show the ink box for a whole-contour or whole-glyph selection and the skeleton box, labelled, for a partial selection; move edits are exact; resize edits use M9a and land within tolerance or are refused with a reason, changing nothing; a glyph and a glyph using it as a component get the same ink edge from the same typed value.
  - Verify: `TestEditor` tests for the overshoot example (`o`, Y minimum -10), the siblings case, refusal, the partial selection.
  - Files: `TransformSection.tsx`, `useSelectionBounds`, a bounds-edit command, the Rust fit.

### Phase 4: Close

- [ ] **M10. Verify, docs, Checkpoint E** (S)
  - Acceptance: `cargo fmt`, clippy at the ratchet, `pnpm typecheck`, `lint:check`, format on touched files, `shift-font`, `shift-wasm`, editor and desktop suites green; DOCS (`model`, `editor`, `shift-font` and `shift-wasm` where they describe measures) updated; ROADMAP A3.3 ticked; Tasos hand-checks the switch, a sidebearing, the re-apply and a bound.
  - Verify: the full commands in the spec.

## Checkpoints

- **Checkpoint E (after M8, Tasos):** a stroked glyph spaces by its ink in the inspector and the spacing tool; the switch flips it; re-apply works.
- **Checkpoint F (after M9, Tasos):** type a Y minimum on a stroked `o` and on a sibling; the ink edge lands.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The edge fit is not monotonic (miters, caps, overlapping inner offsets) | Resize edits land wrong or fail | M9a is a spike with a refusal path; moves, sidebearings and the rest do not depend on it |
| Ink solves in the workspace make linked metrics slow on big fonts | Typing in the inspector lags | M2 measures; the cache is content-keyed; re-apply "Whole font" is explicit, not automatic |
| A TS reader keeps its own sidebearing maths and is missed | One surface disagrees with the rest | M7's audit list is the checklist; each reader gets a test; Q-met-3 is closed by it |
| Partial selection has no ink | Confusing numbers | Labelled "skeleton"; the spec says why |
| Export is not yet solved | The promise "exported sidebearings equal ink" is unverified | `a-stroke-export` owns the parity test; recorded there |

## Open questions

See the spec: Q-met-4 (fit reliability, M9a), Q-met-5 (align and distribute on ink), Q-met-6 (a typed bound versus a later stroke change).

## Results

- **M2 ink read cost:** one `Font::layer_extent` on a 151-point stroked skeleton (50 cubics, round 24, tolerance 0.25) took **9.25 ms** in debug (`one_ink_read_on_a_dense_stroked_glyph_is_timed`). ~600-point fixture not added; scale roughly with solve cache tests.
- **Mutation check:** `measure_mutation_check_ink_extent_changes_lsb_not_skeleton` fails if `glyph_extent_contours` ignores `metrics_measure()` and always uses skeleton contours in `evaluate.rs`.
- **Deviations:** `FontChangeFlag::StrokeMeasure` added (15 flags; was 14). Component ink uses recursive `ink_contours_for_glyph` via `GlyphComponents::occurrences` (not a second copy of composite flattening). Store round-trip for `ignoreStroke` inherits generic lib persistence (no shift-store schema change). Export parity: key is editor metadata like `com.shift.languages` (not read by compile paths).
- **M6:** `LayerExtent` carries `skeleton` and optional `ink` `MeasureBounds` plus `BetweenMasters` fallback; `stroke_extent.rs` exports the wasm read; `FontHeader.includeStrokeInMetrics` mirrors the switch; editor tests: `layerExtent.test.ts` (switch re-derive mutation: ink LSB changes when `setIgnoreStroke` runs while geometry stays fixed).
- **M7:** `Font.metricsSidebearingsCell` + `GlyphLayer`/`GlyphRenderModel` wire every audited reader; `Guides` verticals at ink edges; behaviour: `strokeMetrics.test.ts`.
- **M8:** Glyph sidebar Include stroke checkbox, skeleton secondary labels, fallback tooltip; `GlyphReapplyMetrics` in heading slot (desktop `RightSidebar`); no drag-frame inspector test yet (deferred to M10 verify).
- **Review (TS, 2026-11-21):** Root cause of re-apply crash: `FontChangeFlag::StrokeMeasure` was in Rust but absent from stale `packages/wasm/src/generated-protocol` until `pnpm build:wasm` (pack `FontChangeFlagSchema.names`); `SessionEngine` built 14 revisions, `revision("strokeMeasure")` threw. `pnpm generate:bridge-types` failed because `InkMeasureRuntime` used `RefCell` inside `Font` (`shift-backends` needs `Send + Sync`); fixed with `RwLock`. Regression: `fontChangeFlags.test.ts` + `layerExtent` reapply smoke. M7 gaps closed: `TextRunNodeDefinition` spacing gaps use metrics sidebearings; `Glyph.renderModelAt` passes `#metricsSidebearingsCell` (fixes `options is not defined`). Behaviour: `strokeMetricsReaders.test.ts` (spacing, guides via drawn glyph, transform RSB, batch set sidebearings, drag preview, fallbacks). Mutation: spacing test fails when gaps read skeleton bounds (`rsb` unchanged with include-stroke toggle).

### Results (M9a)

| Case | Outcome | Typical iterations |
| --- | --- | --- |
| Round cap, open horizontal stem — grow/shrink `Left` | Lands within 0.25; verified by re-solve | 1–4 |
| Square cap, open vertical stem — `Bottom` | Lands | 1–3 |
| Miter join, closed square ring — `Top` height | Lands | 2–5 |
| Already at target | `scale = 1`, 0 iterations | 0 |
| Top target below stroke width (80 on tall stem) | `TargetSmallerThanStroke` or `NonMonotonic` | — |
| Acute backtrack + miter (stress) | Lands **or** `NonMonotonic` / `DidNotConverge` (refused) | — |
| Zero skeleton span on fit axis | `NonMonotonic` (no bracket) | — |

**Reliability:** Bisection on a sampled bracket after a monotonicity walk is reliable for round/square caps, miters on simple rings, and open stems where the skeleton has extent on the fit axis. Refuse rather than guess when the target is below the stroke footprint, the skeleton has no span on that axis (e.g. vertical stem + `Left`/`Right`), or miter spikes break monotonicity.

**Ink read cost (~601 skeleton points, closed wavy ring, round 24, tolerance 0.25, release 2026-11-21):** cold **18.56 ms**, warm **~14.5 ms** — under the 40 ms budget. Cold path is kurbo solve + assembly; **warm reuses solved outlines** (cache counter flat) but time is still dominated by projection/flatten/clone before bbox, not bounds math. **Proposal:** optional content-keyed `LayerExtent` memo beside the solve cache (out of scope unless trivial).

- **M1 gap fill (Rust, 2026-11-21):** square-cap open-stem extent; rotated stroked component ink vs transformed skeleton AABB; style restyle changes ink / warm re-read does not add solves (`stroke::ink` tests).
- **M4/M5 gap fill (Rust):** `linked_metrics/stroke_metrics_tests.rs` — `=n` follows ink after stroke change; height `@`; `SetSidebearings` lands ink LSB/RSB; `SetIgnoreStroke` touches no layer; `ReapplyLinkedMetrics` glyph/font undo+redo; disabled reason; mutation via skeleton evaluator.
- **Fixes:** empty-outline glyphs surface `NoOutline` again (`skeleton_bounds_for_extent`); `ReapplyLinkedMetrics` intent returns `moved_layers` for undo.

**Recommended M9 API:** Keep the fit spike as a pure Rust helper; wire M9/metrics intents to call it, then apply skeleton `MovePoints`/`setPositions` at the returned scale.

```rust
pub fn fit_ink_edge(font: &Font, request: InkEdgeFitRequest) -> Result<InkEdgeFitResult, InkEdgeFitError>
// InkEdgeFitRequest { layer_id, contour_ids, edge: InkBoxEdge, target, tolerance }
// M9 intent: FitInkBound { layer_id, contour_ids, edge, target } -> applies scale to selection
```

### Integration verification (2026-11-21, `explore/strokes` @ `192840f73`)

| Command | Result | Pre-existing or ours |
| --- | --- | --- |
| `pnpm build:wasm` | pass | — |
| `cargo test -p shift-font` | pass (incl. ink tests that failed under concurrent edits) | — |
| `cargo test -p shift-wasm --features engine` | pass | — |
| `cargo fmt --check` | pass | — |
| `node scripts/clippy-ratchet.mjs` | exit 1, **15** warnings outside ratchet | **Ours:** 14 from `ink.rs` / `ink_fit.rs` / stroke test helpers (vs **2** at `9691ec1e5` before M1); **Ours (fixed):** +1 `redundant_clone` in `apply.rs` (16th hit) → `1e81b1101` |
| `pnpm typecheck` | pass | **Ours (fixed):** LayerExtent union, reapply scope, metrics empty state — `65b7e95fb` |
| `pnpm lint:check` (turbo) | fail `@shift/wasm` | **Pre-existing:** local untracked `packages/wasm/src/generated-reference/` (oxlint passes with that dir removed) |
| `pnpm lint:check` (`packages/editor`, `apps/desktop` oxlint) | pass | **Ours (fixed):** reactive reads, duplicate imports, test surface — `65b7e95fb`, `192840f73` |
| `pnpm format:check` | fail | **Pre-existing:** untracked `generated-reference/`; touched paths formatted |
| `pnpm --dir packages/editor exec vitest run` | **736** pass | — |
| `pnpm --dir apps/desktop exec vitest run src/renderer/src/behaviour/strokes` | **29** pass | — |
| `pnpm --dir apps/desktop exec vitest run` | **7** fail / **1753** pass | **Pre-existing:** same `linked-metrics.test.ts` failure at `7e3e44772` (e.g. LSB 50 vs 40 after undo) |
| `python3 scripts/context-drift-check.py` | pass (doc drift WARNs only) | — |

**Checkpoint E (hand):** automation for M6–M8 is green on strokes/metrics paths after integration fixes; safe for Tasos to verify switch, ink sidebearings, spacing, re-apply. **Not** ready for M10 sign-off (full desktop green, root `lint:check`/`format:check` with local wasm reference tree, clippy debt on ink files, M9 open).

### Results (M9)

- **Rust:** `selection_extent` (whole layer or contour subset), `FitInkBound` intent calling `fit_ink_edge` then scaling the selection about the opposite edge; four unit tests in `stroke/ink_bounds.rs`.
- **Resize semantics:** typing **width** fits the **right** ink edge (`target = left + W`, left fixed via anchor at skeleton `min_x`); typing **height** fits the **top** ink edge (`target = bottom + H`, bottom fixed). Move (x/y) translates by `typed − current` on the displayed ink box.
- **TS:** `transformSelectionBounds` + `Engine.transformSelectionBoundsCell`; Transform panel uses ink bounds for whole stroked contour / whole-glyph selection, shows **skeleton** label for partial selection or fallback; resize refuses via toast (`notify`) on fit errors.
- **Tests:** `strokeMetricsBounds.test.ts` — move Y (top shifts by the same delta), one undo step, resize within tolerance, refusal below stroke width (geometry unchanged), component glyph same ink bottom, partial skeleton label, include-stroke off; `TestEditor` transform-panel helpers on `EditorTestSurface`. `pnpm --dir apps/desktop exec vitest run src/renderer/src/behaviour/strokes` → **36** pass.
- **Mutation:** forcing ink selections to skeleton mode fails `measure === "ink"` on the move test (`transformSelectionBounds` return path).
- **Deviations:** `FitInkBound` crosses wasm protocol first; bridge `protocol.ts` still lacks the variant until a bridge rebuild (editor uses `@shift/wasm/protocol` for the payload type). Component-only glyphs use `wholeLayerTransformBounds` when every component is selected (no local contours).
