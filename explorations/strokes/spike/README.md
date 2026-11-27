# Exact-offset spike (F0.3 / F0.4)

Historical CP0 experiment: turn **skeleton centerlines** into **constant-width outlines** using kurbo 0.13 [`stroke`](https://docs.rs/kurbo/0.13.0/kurbo/fn.stroke.html). **`ExactOffset` now lives in product** [`shift-font::stroke::exact_offset`](../../../crates/shift-font/src/stroke/exact_offset.rs); this crate is optional for local eyeballing only.

## Run

From the repo root, inside the Nix dev shell:

```bash
cd explorations/strokes/spike
nix develop --command cargo run
nix develop --command cargo test
```

Or from anywhere:

```bash
nix develop --command bash -c 'cd explorations/strokes/spike && cargo run'
```

## Fixtures

| File | Role |
| ---- | ---- |
| `fixtures/icon-l-stroke.json` | Open L-shaped icon centerline (two 90° turns) |
| `fixtures/open-line.json` | Open horizontal segment (cap behaviour) |
| `fixtures/*.svg` | Same skeleton geometry for visual reference |

JSON is what the binary loads (`path_d` + `stroke_width`). SVG is for eyeballing in a browser.

## What the binary prints

For each fixture with **round cap + round join** (Figma-like defaults):

- Outline element / on-curve / cubic counts
- Axis-aligned bbox
- For `open-line`, a **Butt vs Round** cap point-count comparison

Tolerance is fixed at `0.25` (font-unit scale); kurbo scales error with width — tighten when outlines are scaled up.

## Outline quality observations (initial spike)

Run `cargo run` and compare numbers on your machine; typical shapes:

| Fixture | Skeleton | Round cap + join (example run) |
| ------- | -------- | ------------------------------ |
| **open-line** | 1 segment, width 20 | 7 on-curve / 4 cubics; bbox 180×20 (height ≈ width); **butt** caps → 4 on-curve / 0 cubics. |
| **icon-l-stroke** | 2-segment L, width 24 | 11 on-curve / 5 cubics; bbox 84×84; round join adds fillet cubics at the corner. |

Kurbo often omits a `ClosePath` element but still returns to the start point (geometrically closed fill).

**Takeaways for F0.4:**

1. Expanded strokes are **closed** `BezPath`s suitable for fill, even when the skeleton is open.
2. **Open skeletons** need explicit cap policy in the nib track (round vs butt changes point count and end geometry).
3. Corners on polylines are joins, not just parallel offsets — expect extra segments at the L.
4. Point count is a practical quality metric until we add extrema / self-intersection checks upstream.

## Caps and joins

Documented in the module header of `exact_offset.rs`:

- `Cap::Round` — radius `width/2` semicircles on open ends.
- `Join::Round` — circular fillet between skeleton segments.

## Next steps (product, not this crate)

- Nib sweep backend and refit policy live in shift-font once F0.3 broadens beyond constant width.
- Compare kurbo output to `offset_cubic` on individual segments if we need centerline-only offset without width.