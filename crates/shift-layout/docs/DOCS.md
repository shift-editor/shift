# shift-layout

<!-- reviewed: 2026-10-21 review-every: 90d -->

Lays out pages of frames and text runs in Shift's auto layout vocabulary (Figma's words), with Taffy's flexbox doing rows and columns. Pure Rust: no I/O, no JavaScript, built natively for tests and into `@shift/wasm/shaping` for the editor.

## Architecture Invariants

- **Shift's vocabulary, never Taffy's.** Every public type is Shift's own: `LayoutTree`, `FrameLayout` (`free`/`row`/`column`, gap, padding, align, justify, wrap), `Sizing` (`fixed`/`hug`/`fill`), `Placement` (`auto`/`absolute`). Taffy is private to `engine.rs`. Records persist these words, so Taffy can be upgraded or replaced without a file migration.
- **One pass, no callbacks.** `LayoutTree::layout` takes the whole page and returns every box and every text run's lines. Text is measured before the call (`BreakSegments`); the measure function only breaks lines over those widths. A host across a boundary crosses it once per layout (the bakeoff measured 11k JavaScript measure callbacks at 438 ms against about 1 ms pre-measured).
- **Taffy lays out rows and columns only.** A row or column shows Taffy just the children that follow its layout. Children of free frames and the page, and absolute children, are sized here as if alone and set at their positions; Taffy's absolute positioning, grid, and block layout are not compiled in.
- **Hug means content size, as in Figma.** A hugging axis is laid out with unlimited room whatever its parent offers, so hugging frames and text runs never shrink or wrap to fit a narrower parent. CSS would shrink them to fit.
- **`fill` exists only in a row or column.** Along the main axis it grows (and shrinks) to share the room left; across it, it stretches to the inner size. Anywhere else it lays out as `hug`.
- **Text height always hugs.** A text run is as tall as its lines times its line height; its height sizing is ignored.
- **Deterministic.** No hashing, no rounding to pixels; the same tree gives the same boxes. Layout runs in `f32`, so boxes carry about seven significant digits.

## Codemap

```text
crates/shift-layout/src/
  lib.rs      crate surface
  tree.rs     LayoutTree, LayoutNode, NodeKind, FrameLayout, Sizing, Insets, Align, Justify, Placement
  text.rs     BreakSegments, LineRange, greedy line breaking
  page.rs     PageLayout, LayoutBox, TextLines, LayoutError, LayoutTree::layout
  engine.rs   the Taffy adapter: styles, the measure function, free and absolute placement
  tests.rs    page layout through the public API, and the 1k/5k/10k-leaf perf mark
```

## Key Types

- `LayoutTree` — one page, parents before children, the page first. `layout()` validates it and returns a `PageLayout` or a `LayoutError`.
- `NodeKind` — `Page` (root, free, hugs), `Frame(FrameLayout)`, `Text(BreakSegments)`, `Fixed(Size)` (a leaf with an intrinsic size it hugs to).
- `BreakSegments` — a text run cut where lines may break: segment widths, the space after each, hard breaks, line height (all in the run's units), and `scale` to scene units. `break_lines(width)` works on its own.
- `PageLayout` — a `LayoutBox` per input node, in input order (origin in the parent's frame, Y-down, scene units), and `TextLines` (lines as segment ranges plus width) per text run.

## How it works

`Engine::new` validates the tree and translates each node into a slot holding a Taffy `Style`: fixed sizes become lengths, `fill` becomes `flex-grow: 1; flex-basis: 0` along the parent's main axis or `align-self: stretch` across it, and everything else neither grows nor shrinks. A row or column becomes a flex container with gap, padding, `align-items`, `justify-content`, and `align-content: start` for wrapped lines. Its auto children become its Taffy children; every other child goes on a list placed by position.

Layout starts at the page, a free container. A free container sizes each placed child with unlimited room, sets it at its position, and is as big as its fixed size or the farthest child edge from its origin. A row or column runs Taffy's flexbox, then places its absolute children the same way. Text runs are Taffy leaves: the measure function breaks lines at the offered width (none for a hugging run) and returns the widest line and the lines' height, scaled. Taffy caches each node's measurements per input within the pass.

Line breaking is greedy: a line takes segments while they fit, counting the space between them but not after the last; a segment wider than the line gets its own line; a hard break ends a line. A small relative tolerance keeps a width measured as the longest line from wrapping after its round trip through `f32`. After layout, each text run's lines are broken once more at its final width and returned.

## Workflow recipes

### Adding a frame property

1. Add it to `FrameLayout` (or `LayoutNode`) in Shift's words, documented in `tree.rs`.
2. Translate it into the Taffy style in `engine.rs` (`stack` for containers, `follow` for items).
3. Add a test in `tests.rs` that asserts boxes, then carry it across the boundary in `crates/shift-wasm/src/page_layout.rs` and run `pnpm generate:from-rust`.

## Gotchas

- **Baseline alignment uses bottom edges.** Text runs and leaves report no baseline yet, so `Align::Baseline` lines up their bottom edges. Reporting a text run's first baseline needs its ascent in `BreakSegments`.
- **A kern pair across a break is counted in the segment width.** Break segments are measured before breaking, so a kern between the last glyph of one segment and the first of the next stays in the width.
- **A free frame's box starts at its origin.** Children at negative positions extend outside it; the box covers from the origin to the farthest child edge.

## Verification

```bash
nix develop --command cargo test -p shift-layout
nix develop --command cargo test --release -p shift-layout -- perf_mark --ignored --nocapture  # 1k/5k/10k-leaf timing and budget
nix develop --command cargo clippy -p shift-layout --all-targets -- -D warnings
nix develop --command cargo check -p shift-layout --target wasm32-unknown-unknown
```

## Related

- [`crates/shift-wasm/docs/DOCS.md`](../../shift-wasm/docs/DOCS.md) — `layoutPage`, the export that runs this in the editor.
- [`crates/shift-shape/docs/DOCS.md`](../../shift-shape/docs/DOCS.md) — line-break opportunities the editor cuts break segments at.
