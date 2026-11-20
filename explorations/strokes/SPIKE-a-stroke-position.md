# Spike: stroke position and offset on open paths

**Date:** 2026-11-20. **Status:** spike done, rule works, decisions made.
**Code:** `crates/shift-font/src/stroke/position.rs` (16 tests; not wired to anything yet).

## Question

Can a stroke lie on one side of its skeleton, for open and closed contours, and can Offset Contour work on open contours, at the cost and quality of the stroke we already ship?

## Result

Yes. Two functions, both in Rust, no new dependency (kurbo's public `offset_cubic` does the curve work).

- `offset_path(path, distance, join, miter_limit, tol)`: the parallel curve of an open or closed path. Positive distance is left of the direction of travel. An open path stays open. This is what Offset Contour needs on open contours.
- `aligned_outline(skeleton, style, position, tol)`: the stroke with `position` in `[-1, 1]`. `-1` entirely left, `+1` entirely right, `0` centred (calls the existing `outline`, so nothing changes for existing strokes). It builds the stroke from two offsets of the skeleton, at `−position·w/2 ± w/2`, joined by caps. The edge at offset 0 is the skeleton itself.

Left is the left of the direction of travel in y-up coordinates. A counter-clockwise closed contour has its inside on the left, so −100 % reads as inside there and +100 % as outside. Reversing a path swaps the side.

## Measurements

| Check                                                                                 | Result                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| Edge distance from the skeleton, smooth curved skeleton, left and right (oracle)       | 0.000 max deviation from {0, width}         |
| Open offset distance, ±4, smooth curved skeleton (oracle)                              | 0.000 max deviation                         |
| Direct construction vs shifting the skeleton and stroking centred (grid XOR)           | ≤ 0.013 % of covered cells differ           |
| Position → 0 vs the centred stroke, butt / square / round                              | 0.000 % differ (no jump at the 0 boundary)  |
| Line bounds at width 20: left `y∈[0,20]`, right `[−20,0]`, position −0.5 `[−5,15]`; caps centred on the shifted line | pass |
| Closed square, inside and outside ring areas                                           | pass                                        |
| Release time, 67 smooth cubics: centred / direct one-sided / shift-then-stroke         | 0.025 / 0.016 / 0.037 ms; 139 on-curve each |
| Release time, 67 tight cubics (radius < 10): same three                                | 0.499 ms / 0.258 ms / 1.293 ms; 1009 / 574 / 3640 on-curve |

Shifting the skeleton and then stroking it was the first prototype. It gives the same shape but costs 2.6× the centred stroke on the tight skeleton and has 3.6× the points, because it offsets twice. Building from two offsets is cheaper than the centred stroke, so the one-sided stroke fits the existing preview budget.

## Findings

1. **Inner corners overlap.** Where the offset runs inside a turn, the two offset segments meet in a line and the outline overlaps itself. A nonzero fill reads it right (tested on the closed square and the open polyline), which is also how the centred stroke leaves its overlaps. Export must remove overlaps, which `a-stroke-export` needs for the centred stroke anyway.
2. **Outer corners follow the join.** Round, miter (with the miter limit) and bevel all work on the offset edge. The edge on the skeleton itself needs no join, which is why a 100 % position keeps the skeleton's corners crisp on that side.
3. **Curvature smaller than the offset behaves like the centred stroke.** A radius-10 circle offset 30 inward leaves a hole at the middle, exactly as the centred stroke of a radius-5 circle at width 30 does (the stroker, not the offset, decides). The sweep would cover the middle. This is a pre-existing limit, noted, not fixed here.
4. **Caps ride the shifted line.** The cap is centred on the middle of the stroke, not on the skeleton, so a left-aligned round cap bulges past the skeleton's end by half the width. A designer drawing a straight line gets a flush edge on one side and a cap past the end; whether that is the wanted cap behaviour is untested against Glyphs.
5. **Direction is the visible cue.** Left and right depend on path direction, so the panel needs a direction arrow on the selected stroke (not checked whether the editor already draws one) and the row label must say left / right, not inside / outside. For closed contours the tooltip can add the inside / outside reading for the contour's current winding.

## Decisions (Tasos, 2026-11-20)

- **D-P1: storage. Yes.** `position: f64` joins `OutlineStrokeStyle` and every place the style crosses a boundary. Nothing uses strokes yet, so no backward compatibility: no serde default, no migration, change the shape wherever it makes sense.
- **D-P2: convention.** One signed value, shown as a percent: **−100 % left, 0 % centre, +100 % right**. The same value is stored, passed and displayed, with no second convention. `aligned_outline` takes this `position` (the spike's first draft had left positive; flipped). Clamped to `[-1, 1]`.
- **D-P3: Offset Contour. Yes, for all paths.** It uses `offset_path` for open and closed contours alike, and the same −100 % … +100 % reading applies to its side, so the dialog's inside / outside choice becomes that signed value.

## What it changes in the plan

- `a-stroke-panel`: add a Position row between Width and Join, plus a direction cue (P-new), and let Offset Contour… accept open contours. The `live_strokes` read (P1) returns `position` with the rest of the style.
- New module `a-stroke-position`: spec the data-model change and wire `aligned_outline` into the solve and cache key (side joins the cache key), the preview and the expand command. It must land before `a-stroke-panel` builds the Position row, since the style type changes.
- `a-stroke-export`: overlap removal covers both centred and one-sided strokes.
