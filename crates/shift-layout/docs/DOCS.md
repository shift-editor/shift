# shift-layout

<!-- reviewed: 2026-11-01 review-every: 90d -->

Lays out pages of frames and text runs in Shift's auto layout vocabulary (Figma's words), with Taffy's flexbox doing rows and columns. Pure Rust: no I/O, no JavaScript. The editing engine (`crates/shift-wasm`, `EngineReads::page_layout`) runs it over the scene; the scene (`crates/shift-engine`) stores its vocabulary.

## Architecture Invariants

- **Shift's vocabulary, never Taffy's.** Every public type is Shift's own: `LayoutTree`, `FrameLayout` (`LayoutDirection` `free`/`row`/`column`, gap, `Insets` padding, `Align`, `Justify`, wrap), `Sizing` (`fixed`/`hug`/`fill`) per axis in `BoxSizing`, `Placement` (`auto`/`absolute`). Taffy is private to `engine.rs`. The scene persists these words, so Taffy can be upgraded or replaced without a file migration.
- **The vocabulary builds without Taffy.** The `layout` feature (on by default, off in the workspace dependency) compiles Taffy and `LayoutTree::layout`; `serde` and `pack` derive the stored and wire forms. shift-engine takes `pack` and `serde` only, so the native workspace, store and bridge never compile Taffy; the engine module turns `layout` on.
- **One line-breaking rule.** Text is not broken here. `LayoutTree::layout` asks the caller's `MeasureText` for a run's size at each width it considers (`None` for no limit, `Some(0.0)` for the narrowest), and returns the width each run's lines break at (`PageLayout::text_widths`). The engine measures with shift-text's layout, the one every host uses, so a run wraps on a page where UAX #14 lets it, as anywhere else. **WHY:** #758 broke lines greedily over pre-measured segments, a second rule that disagreed with shift-text's at kerning, marks and bidi.
- **Taffy lays out rows and columns only.** A row or column shows Taffy just the children that follow its layout. Children of free frames and the page, and absolute children, are sized here as if alone and set at their positions; Taffy's absolute positioning, grid, and block layout are not compiled in.
- **Hug means content size, as in Figma.** A hugging axis is laid out with unlimited room whatever its parent offers, so hugging frames and text runs never shrink or wrap to fit a narrower parent. CSS would shrink them to fit.
- **`fill` exists only in a row or column.** Along the main axis it grows (and shrinks) to share the room left; across it, it stretches to the inner size. Anywhere else it lays out as `hug`.
- **Text height always hugs.** A text run is as tall as its measured lines; its height sizing is ignored.
- **Deterministic.** No hashing, no rounding to pixels; the same tree and measurements give the same boxes. Layout runs in `f32`, so boxes carry about seven significant digits; measured sizes round up to the next `f32`, so a run offered back the width it measured keeps its lines.

## Codemap

```text
crates/shift-layout/src/
  lib.rs         crate surface
  vocabulary.rs  FrameLayout, LayoutDirection, Sizing, BoxSizing, Insets, Align, Justify, Placement (stored by the scene)
  tree.rs        LayoutTree, LayoutNode, NodeKind
  page.rs        MeasureText, PageLayout, LayoutBox, TextWidth, LayoutError, LayoutTree::layout  (feature `layout`)
  engine.rs      the Taffy adapter: styles, text measurement, free and absolute placement     (feature `layout`)
  tests.rs       page layout through the public API, text laid out by shift-text; the 1k-leaf timing
```

## Key Types

- `LayoutTree` — one page, parents before children, the page first. `layout(&mut impl MeasureText)` validates it and returns a `PageLayout` or a `LayoutError`.
- `NodeKind` — `Page` (root, free, hugs), `Frame(FrameLayout)`, `Text` (measured through `MeasureText`), `Fixed(Size)` (a leaf with an intrinsic size it hugs to).
- `MeasureText` — `measure(node, width) -> Size` in scene units: the widest line and the lines' height at that width. Called several times per run and width within one layout; the engine keeps each layout for the pass.
- `PageLayout` — a `LayoutBox` per input node, in input order (origin in the parent's frame, Y-down, scene units), and a `TextWidth` per text run (`None` for a hugging run).

## How it works

`Engine::new` validates the tree and translates each node into a slot holding a Taffy `Style`: fixed sizes become lengths, `fill` becomes `flex-grow: 1; flex-basis: 0` along the parent's main axis or `align-self: stretch` across it, and everything else neither grows nor shrinks. A row or column becomes a flex container with gap, padding, `align-items`, `justify-content`, and `align-content: start` for wrapped lines. Its auto children become its Taffy children; every other child goes on a list placed by position.

Layout starts at the page, a free container. A free container sizes each placed child with unlimited room, sets it at its position, and is as big as its fixed size or the farthest child edge from its origin. A row or column runs Taffy's flexbox, then places its absolute children the same way. Text runs are Taffy leaves: the measure function asks `MeasureText` at the offered width (none for a hugging run, zero for min-content) and returns its size. Taffy caches each node's measurements per input within the pass.

## Workflow recipes

### Adding a frame property

1. Add it to `FrameLayout` in `vocabulary.rs`, in Shift's words, with `serde` and `pack` derives on any new type.
2. Translate it into the Taffy style in `engine.rs` (`stack` for containers, `follow` for items).
3. Add a test in `tests.rs` that asserts boxes; add the field to `NodeContent::Frame` in shift-engine with a serde default, and to `SceneNode::frame_layout`.

## Gotchas

- **Baseline alignment uses bottom edges.** Text runs and leaves report no baseline yet, so `Align::Baseline` lines up their bottom edges. Reporting a run's first baseline needs `MeasureText` to answer its ascent.
- **shift-text reads a width of 0 as none.** A measurer over shift-text passes the narrowest positive width for `Some(0.0)`, as the engine's does (`page_layout.rs`).
- **A free frame's box starts at its origin.** Children at negative positions extend outside it; the box covers from the origin to the farthest child edge.

## Verification

```bash
nix develop --command cargo test -p shift-layout
nix develop --command cargo test --release -p shift-layout -- --ignored --nocapture  # 1k-leaf timing
nix develop --command cargo clippy -p shift-layout --all-targets --all-features -- -D warnings
nix develop --command cargo check -p shift-layout --target wasm32-unknown-unknown
```

## Related

- [`crates/shift-wasm/docs/DOCS.md`](../../shift-wasm/docs/DOCS.md) — `EngineReads.pageLayout`, which lays a scene page out with this crate.
- [`crates/shift-text/src/layout/docs/DOCS.md`](../../shift-text/src/layout/docs/DOCS.md) — the text layout runs are measured with.
- [`crates/shift-engine/docs/DOCS.md`](../../shift-engine/docs/DOCS.md) — the scene that stores frames, sizing and placement.
