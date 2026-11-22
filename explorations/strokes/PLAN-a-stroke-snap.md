# Plan: `a-stroke-snap`

**Spec:** [SPEC-a-stroke-snap.md](./SPEC-a-stroke-snap.md) (decided, rounds 1 and 2)
**Branch:** `explore/strokes` (local only)
**Status:** complete. S1–S8 built, committed (`6b109315f`). Checkpoint G behaviour tests added 2026-11-23: 4 WASM integration tests (`inkSnapPoints.test.ts`) + 4 desktop behaviour tests (`strokeInkSnap.test.ts`) covering ink-to-skeleton snap, ink-to-ink snap, skeleton-only baseline, and no-stroke control.

## Overview

The visible edge of a stroked contour snaps to metric lines, the grid and other contours' ink, so an overshoot is placed by the edge you see and repeated across siblings. An ink outline is a path of a different material: its on-curve points and extrema are probes and targets. Components snap and are snapped to like contours. "Include stroke" off turns ink snapping off.

## Architecture decisions

- **Rust computes ink snap points.** A solved stroke outline does not guarantee extrema as on-curve points, so Rust walks each outline segment via `ParamCurveExtrema::extrema()` and returns the positions. TypeScript asks; it never computes extrema.
- **One new WASM read.** `ink_snap_points(layer_id) -> Vec<Point2D>` returns deduplicated on-curve positions plus extrema of the layer's solved outlines (including components' transformed ink). Reuses the solve cache (warm ~14 µs).
- **One new PositionSnapProvider.** `InkAlignmentSnap` wraps the same `AxisIndex` as `PointAlignmentSnap` but emits a new guide kind `"inkAlignment"` so the renderer draws the "ink" tag.
- **Registered in Snapping.forLayer.** A seam stays open for guidelines, the measurement tool and the ruler (future providers on the same list). The ink provider is added only when the layer has dynamic strokes and Include stroke is on.
- **Component targets are a separate provider.** Today `layer.allPoints` is the root's authored on-curve points; components contribute nothing. A new `ComponentAlignmentSnap` provider offers each component's outline points (or ink outline + extrema when stroked) as targets. This is a visible change for plain components and is called out in tests.
- **Ink probes when dragging a stroked contour.** `Translate.#configurePositionSnap` adds the moving contours' ink extrema as extra `PositionReference.position(...)` probes so the dragged ink edge tests against targets.
- **The switch.** `Include stroke` off removes the ink snap provider and the ink probes. Skeleton points remain.
- **Tie-break = the path rule.** Nearest correction per axis, same as `PointAlignmentSnap`. O1 (pointer-nearest) revisited only if Tasos's feel test says so.

## Dependency graph

```
S1 Rust ink snap points ─► S2 WASM read ─┬─► S4 wire into Snapping.forLayer
                                         │
S3 InkAlignmentSnap ─────────────────────┘
                                         ├─► S5 component targets
                                         ├─► S6 ink probes
                                         └─► S7 switch integration

S4 + S5 + S6 + S7 ──► S8 verify, docs, Checkpoint G
```

S1 and S3 can start together (S3 needs only the data shape, not the read). S5 can run alongside S4.

## Tasks

### Phase 1: Rust + WASM

- [x] **S1. Ink snap points of a solved outline** (M)
  - A Rust function in `shift-font/src/stroke/ink_snap.rs` (new) that takes a layer and the solve cache and returns `Vec<kurbo::Point>`: the on-curve points of each solved outline contour, plus the parametric extrema of each outline segment (`ParamCurveExtrema::extrema()` → `ParamCurve::eval(t)`), deduplicated within the solve tolerance. Plain contours in the same layer are not included (they have their own authored points). Component ink is the base glyph's ink snap points with the component's transform applied to each point.
  - Accepts a `Measure` and the font's `include_stroke_in_metrics()` state: returns empty when the measure is `Skeleton` and `ignore_stroke` is on (the switch).
  - Verify: `cargo test -p shift-font`; tests first.
    - Vertical stem at x = 100, round 40: extrema at (80, 0), (80, 200), (120, 0), (120, 200) — the left/right/top/bottom of the solved outline. On-curve points include the outline's authored on-curves.
    - Closed ring (square, round stroke): extrema at the four cardinal points of the outer and inner outlines.
    - Open contour with square cap: extrema include the cap corners.
    - A component with a rotated stroked base: points are the base's ink snap points after the component's transform.
    - `ignore_stroke = true` → empty.
    - A plain (no stroke) layer → empty.
    - Mutation check: changing the stroke style changes the returned points.
  - Files: `shift-font/src/stroke/ink_snap.rs` (new), `stroke/mod.rs` (re-export).

- [x] **S2. WASM read** (S)
  - `EngineReads::ink_snap_points(layer_id) -> Result<Vec<Point2D>, ...>` follows `previewed`, returns the deduplicated positions. Reuses the existing solve cache on the font. The returned points are flat `(x, y)` pairs (no ids, no types), packed as `Vec<f64>` for the protocol.
  - Verify: `cargo test -p shift-wasm --features engine`.
    - A stroked layer's read returns the same point count as the Rust unit test.
    - A non-stroked layer returns empty.
    - After a style change the read returns different points.
  - Files: `shift-wasm/src/ink_snap.rs` (new), `engine_reads.rs`, `lib.rs`.

### Phase 2: TypeScript snap infrastructure

- [x] **S3. InkAlignmentSnap provider** (M)
  - A new `PositionSnapProvider` in `packages/editor/src/lib/model/positions/InkAlignmentSnap.ts`. Same binary-search axis index as `PointAlignmentSnap`, but `snap()` returns a new guide kind `"inkAlignment"`.
  - New guide type in `types/positionEdit.ts`:
    ```typescript
    export interface InkAlignmentPositionGuide {
      readonly kind: "inkAlignment";
      readonly target: Point2D;
      readonly point: Point2D;
    }
    ```
  - `PositionGuide` union extended. `settleGuide` in `SnapSet.ts` handles `"inkAlignment"` the same as `"alignment"`.
  - `SnapLines.draw` draws `"inkAlignment"` guides as the same snap line + a small "ink" tag label beside the cross on the target. The tag uses the same snap colour at a smaller font size; the renderer picks it up from `canvas.theme.snap`.
  - Verify: `packages/editor` unit tests.
    - `InkAlignmentSnap.to([{x:80,y:0}], 5).snap({x:82,y:50})` → x snap with offset −2, guide kind `"inkAlignment"`.
    - `snapFeedback` with an `"inkAlignment"` guide produces a line and markers.
  - Files: `InkAlignmentSnap.ts` (new), `types/positionEdit.ts`, `SnapSet.ts` (`settleGuide`), `SnapLines.ts`, `positions/index.ts`.

- [x] **S4. Wire into Snapping.forLayer** (M)
  - `Snapping.forLayer` gains an optional `inkPoints` parameter (or reads them from the layer/font). When the layer has dynamic strokes and Include stroke is on, an `InkAlignmentSnap` provider is added to the providers list before the grid.
  - `SnappingContext` gains a method to read ink snap points for a layer: `inkSnapPoints(layerId: LayerId): Point2D[]`. The `Editor` implementation calls the WASM read (S2) and caches the result per layer revision (or reads it once per drag, since the SnapSet is frozen).
  - The `PositionSnapProvider` seam for future guidelines and measurement tool: `forLayer` accepts an optional `extraProviders` list; ink is the first user.
  - Skeleton point targets from `layer.allPoints` stay unchanged.
  - Verify: `packages/editor` behaviour tests through `TestEditor`.
    - A stroked stem at x = 100, width 40: dragging another point near x = 80 snaps it to 80 (the ink left edge), guide is `"inkAlignment"`.
    - With `ignoreStroke = true`: no ink snap, only the skeleton at x = 100.
    - A plain glyph: no ink provider registered, behaviour unchanged.
  - Files: `Snapping.ts`, `SnappingContext` interface, `Editor.ts` (implements context method).

- [x] **S5. Component snap targets** (M)
  - Today a component's placement snaps to the grid only; the component's outline is neither a source nor a target.
  - New: `Snapping.forLayer` adds each component's on-curve outline points as targets. For a stroked component, its ink snap points (from S2, following the component transform applied by Rust) are used instead. For a plain component, its resolved base glyph's on-curve points after the component's transform.
  - The data source: `Font.strokeOutlinePreviews` already has the preview outlines. For component points, `GlyphGeometry` resolves components. The `inkSnapPoints` WASM read (S2) already includes components' transformed ink.
  - For plain component targets, a new `SnappingContext.componentPoints(layer)` method returns on-curve positions of each component's resolved outline.
  - Verify: `TestEditor` behaviour tests.
    - A component of a stroked base glyph: its ink extrema are snap targets. Dragging a point near the component's ink edge snaps to it.
    - A component of a plain base glyph: its outline's on-curve points are snap targets. This is a **visible change** from today (documented in the test name).
    - Mutation check: removing the component removes its targets.
  - Files: `Snapping.ts`, `SnappingContext`, `Editor.ts`.

- [x] **S6. Ink probes for moving stroked contours** (M)
  - When dragging a whole stroked contour (or several), `Translate.#configurePositionSnap` adds the moving contours' ink extrema as probes. Today it uses the moving on-curve points as probes; ink adds the extrema of the moving contours' solved outlines.
  - The moving ink extrema come from the same `inkSnapPoints` read (S2), filtered to the moving contour ids' outline points. If the read returns all ink points for the layer without contour-id attribution, the plan is: Rust returns per-skeleton-contour snap points, so TS can filter. This may require S1 to return `Vec<(ContourId, Vec<Point>)>` instead of flat `Vec<Point>`.
  - The ink probes are `PositionReference.position(point)` (frozen at drag start).
  - Verify: `TestEditor` behaviour tests.
    - Drag a stroked contour whose ink bottom is at y = −10, with a metric line at y = −10: snaps. Today the skeleton at y = 0 would not reach that line.
    - The ink probes are excluded from the ink targets (you do not snap to yourself).
  - Files: `Translate.ts` (`#configurePositionSnap`), `Snapping.ts` (the excluding set must also exclude ink points of moving contours).

- [x] **S7. Switch integration** (S)
  - Already implied by S4: the ink provider is omitted when Include stroke is off. This task pins it with a test and wires the runtime: `Snapping.forLayer` checks the font's `includeStrokeInMetrics` via context.
  - Verify: one behaviour test through `TestEditor`: flip the switch, drag — only skeleton snaps.
  - Files: `Snapping.ts`, test file.

### Phase 3: Close

- [x] **S8. Verify, docs, Checkpoint G** (S)
  - Acceptance: `cargo fmt`, clippy at the ratchet, `pnpm typecheck`, `lint:check`, format on touched files, `shift-font`, `shift-wasm`, editor and desktop suites green; ROADMAP A3.4 ticked; SPEC-map.md status updated; CONSTRAINTS.md measured values updated if changed.
  - Checkpoint G (Tasos, by hand):
    1. Open MutatorSans **o**, apply a ~40 unit round stroke.
    2. Drag a guide (or point of another glyph) to the ink bottom: snaps with an "ink" line and tag.
    3. Drag the stroked **o** toward a metric line: the ink bottom lands on it.
    4. Add a component referencing the stroked **o**; drag a point near the component's ink edge: snaps.
    5. Toggle **Include stroke** off; repeat: only skeleton snaps.
    6. A plain (no-stroke) glyph behaves as today (no regression).
  - Verify: the full commands below.
  - Files: docs, roadmap, spec-map.

## Open questions carried into the plan

| ID  | Question                                             | Decision in this plan                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Pointer-nearest tie-break                            | Ship the path rule (nearest correction per axis). Tasos feel-tests after the build. If pointer-nearest is better, it is a one-function change in `SnapSet.nearest` (replace distance comparison).                                                  |
| O2  | Y-metric snap for ink extrema outside `[0, advance]` | Test it: S4 includes a test where a component's ink extremum sits past the advance. If the metric snap misses it, widen the `acrossAdvance` span to include ink extrema, or leave it (the grid and alignment still snap). Decision by test result. |
| O3  | Where the "ink" tag draws                            | The tag draws beside the cross on the target point, in screen space, at the snap theme colour. S3 implements it; S8 checkpoint confirms it looks right.                                                                                            |

## Risks and mitigations

| Risk                                                                          | Impact                                                                                                                                                                       | Mitigation                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ink snap points are stale during a drag (the outline changes as points move)  | Targets from other contours freeze at drag start, same as today's points; the dragged contour's probes also freeze. If the drag is large the final snap may be slightly off. | Same staleness as skeleton snaps today. Acceptable for v1.                                            |
| Component outline resolution is expensive for large glyphs                    | Snap set build slows down                                                                                                                                                    | The solve cache and extent memo keep it fast; component points are read once per drag. Measure in S8. |
| `InkAlignmentSnap` duplicates `PointAlignmentSnap` logic                      | Maintenance burden                                                                                                                                                           | Extract a shared `AlignmentSnapBase` if the two diverge; for now they share the `AxisIndex` pattern.  |
| O2: Y-metric lines do not reach ink extrema of components outside the advance | A component's ink bottom does not snap to the baseline                                                                                                                       | S4 test; widen `acrossAdvance` to union the advance with the layer's ink x-extent.                    |

## S1 detail: Rust `ink_snap_points`

```rust
// shift-font/src/stroke/ink_snap.rs

use kurbo::{BezPath, ParamCurve, ParamCurveExtrema, PathSeg};

/// On-curve points and parametric extrema of the solved stroke outlines on `layer_id`.
///
/// Returns one entry per skeleton contour that has a live stroke, with the
/// snap-target positions of its solved outline(s). Components contribute
/// their base glyph's ink snap points after the component's transform.
///
/// Returns empty when `ignore_stroke` is on or the layer has no dynamic strokes.
///
/// # Errors
///
/// Returns `CoreError` when the layer cannot be found or resolved.
pub fn ink_snap_points_for_layer(
    font: &Font,
    layer_id: LayerId,
    tolerance: f64,
) -> CoreResult<Vec<InkSnapContour>> { ... }

/// Snap points grouped by the skeleton contour they belong to.
pub struct InkSnapContour {
    pub skeleton_contour_id: ContourId,
    pub points: Vec<kurbo::Point>,
}
```

The function:

1. Checks `font.include_stroke_in_metrics()`; returns empty if off.
2. Reads the layer's solved outlines from the solve cache.
3. For each solved outline subpath, converts to `BezPath`, walks each `PathSeg`, collects on-curve points (line ends, curve ends) and evaluates `ParamCurveExtrema::extrema()` at each t.
4. Deduplicates within the solve tolerance.
5. For components: recursively gets the base glyph's ink snap points and applies the component transform.

## Commands

```bash
nix develop --command cargo test -p shift-font -p shift-wasm --features shift-wasm/engine
nix develop --command pnpm build:wasm
nix develop --command pnpm --dir packages/editor exec vitest run <file>
nix develop --command pnpm --dir apps/desktop exec vitest run <file>
nix develop --command pnpm typecheck
nix develop --command cargo fmt && nix develop --command cargo clippy --workspace --all-targets
nix develop --command pnpm lint:check
nix develop --command pnpm format:check
```

Do not run `pnpm format:files` on the exploration markdown.

## Testing strategy

Behaviour through `TestEditor` and Rust unit tests; state not mock calls.

| What                           | Test                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ink snap points (Rust)         | Vertical stem at x = 100, round stroke 40: returned points include (80, _) and (120, _). Closed ring: cardinal extrema present. Square cap: cap corners present. |
| Extrema computation (Rust)     | A cubic outline segment whose extremum is not an on-curve point: the extremum appears in the returned points.                                                    |
| Component ink (Rust)           | A rotated component of a stroked base: returned points are the base's ink after the transform.                                                                   |
| Switch (Rust)                  | `ignore_stroke = true` → empty.                                                                                                                                  |
| Mutation (Rust)                | Changing the stroke width changes the returned points.                                                                                                           |
| Ink as target (TS)             | Drag a point near a stroked contour's ink edge: snaps with `"inkAlignment"` guide.                                                                               |
| Ink as probe (TS)              | Drag a whole stroked contour toward a metric line: ink bottom lands on it.                                                                                       |
| Component as target (TS)       | Drag a point near a stroked component's ink: snaps.                                                                                                              |
| Plain component as target (TS) | A plain component's outline points are snap targets (visible change from today).                                                                                 |
| Switch off (TS)                | Flip Include stroke off: no ink snap, only skeleton.                                                                                                             |
| Plain glyph (TS)               | A glyph with no stroke: no ink provider, same as today.                                                                                                          |
| Guide kind (TS)                | `InkAlignmentSnap` returns `"inkAlignment"` guides; `SnapLines` draws them.                                                                                      |
| O2 test (TS)                   | A component's ink extremum outside `[0, advance]`: does the metric snap reach it?                                                                                |
| Regression                     | Existing snap tests stay green.                                                                                                                                  |

Every fallback or empty answer is explained (not silently empty).

## Related documents

- [SPEC-a-stroke-snap.md](./SPEC-a-stroke-snap.md) — the decided spec
- [SPEC-a-stroke-metrics.md](./SPEC-a-stroke-metrics.md) — ink extent and the switch
- [PLAN-a-stroke-metrics.md](./PLAN-a-stroke-metrics.md) — plan this is modelled on
- [CONSTRAINTS.md](./CONSTRAINTS.md) — quality bar
- [SPEC-map.md](./SPEC-map.md) — build order
