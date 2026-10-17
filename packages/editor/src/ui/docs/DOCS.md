<!-- reviewed: 2026-10-17 review-every: 90d -->

# Floating Toolbar

The tools bar that floats over the canvas, docked to an edge the user picks by dragging its handle.

## Architecture Invariants

> **Architecture Invariant:** The bar's pose is a pure function of its dock, and a carried bar keeps the pose of the slot it was picked up from for the whole drag. `poseForDock` maps top and bottom to `flat` and both side docks to `stand`, so crossing between the two sides never turns the bar. Pose and placement change only on release. If the bar re-posed while the pointer moved, its footprint would change under the pointer and feed back into which edge is nearest.

> **Architecture Invariant:** The pointer picks the target edge, never the bar. `nextToolbarDrag` steers by pointer-to-edge distance, and the current target keeps a corner until another edge is `SWITCH_MARGIN` closer. Steering by the carried bar's own bounds oscillates at corners because the bar is longer than it is thick.

> **Architecture Invariant:** The remembered dock is the user's intent; the displayed dock is derived. `fitDockToFrame` shows a side dock on the bottom edge when the canvas is too short to hold the bar standing, and nothing overwrites the stored dock until the user drops the bar somewhere. Writing the fitted dock back would forget the user's side choice every time a panel is resized.

> **Architecture Invariant:** The tools' opacity dip during a turn is keyed to the turn's progress, not to the clock. `springEasing(...).timeAtProgress` converts "20% to 50% of the way round" into animation offsets. A spring covers most of its distance early, so a dip centred on half the duration lands on the final stretch of the turn.

> **Architecture Invariant:** Where the handle sits inside the bar is measured from layout offsets at press and carried in `ToolbarDragState.handleInBar`; it is never hard-coded from the CSS padding. Layout offsets ignore a slide or turn that is still settling, so the bar can be grabbed mid-animation without a jump.

## Codemap

```
ui/
├── FloatingToolbar.tsx   — overlay, drop-zone previews, wires the hooks to the bar
├── ToolbarBar.tsx        — the bar itself, FLIP slide and turn about the handle, tools dip
├── ToolsPane.tsx         — the tool buttons and their menus, in either orientation
├── useToolbarDrag.ts     — pointer tracking and the guards that always end a drag
├── useToolbarMetrics.ts  — measured canvas and bar size
├── toolbarDrag.ts        — drag state transitions: tether, steering, capture, lift, tools opacity
├── toolbarPose.ts        — dock to pose, which docks fit, the shown dock
├── toolbarGeometry.ts    — edge distances and handle clamping
├── toolbarPresence.ts    — tools opacity while approaching a turn, and the dip keyframes
├── toolbarStorage.ts     — remembered dock
└── springEasing.ts       — a spring baked into a CSS `linear()` easing
```

## Key Types

- `ToolbarDock`: the edge slot. `ToolbarPose`: `flat` (row, handle at the right end) or `stand` (column, handle at the bottom); the handle is the pivot, so the bar swings between 9 and 12 o'clock.
- `ToolbarDragState`: everything a drag in progress knows. `tether` is non-null while the bar is still held in its slot, `captured` means the target slot is highlighted.

## How it works

A drag starts tethered: the bar stays in its slot until the pointer has moved `TEAR_DISTANCE` (half the bar's thickness), then follows the pointer with the handle clamped inside the frame. The rest of the bar may overflow, and the panel clips it. While the pointer is within `SNAP_DISTANCE` of an edge its slot highlights and the bar lifts; the tools fade as the pointer approaches a slot that would turn the bar.

On release `useToolbarDrag` calls `onDock(drag.target)`. `ToolbarBar` sees the new slot and pose, lays itself out in the new place at once, and animates a slide and a turn from where it was drawn, with the tools dipping through the turn.

## Workflow recipes

### Changing the bar's size or padding

1. Edit the classes in `ToolbarBar`; the handle offset and bar length are measured, so they follow.
2. If the thickness changes, update `BAR_THICKNESS`, the `h-12` and `w-12` drop zones in `FloatingToolbar`, and the `w-12` and `h-12` classes in `ToolbarBar`.
3. Verify: `pnpm turbo run test --filter=@shift/editor`, then drag the bar to every edge by hand.

## Gotchas

- `TOOLBAR_INSET` and the Tailwind `inset-3` in `SLOT_FRAME` and the drop zones are the same 12px written twice. Change both.
- The bar is deliberately unpositioned so it and its handle share the wrapper as offset parent, which makes the `offsetLeft` subtraction exact and unaffected by a running turn. With `relative` the handle would measure from the bar instead, skewing `handleInBar` by the bar's position and border.
- Ctrl+click opens the macOS context menu, which swallows the release, so the press is ignored. Escape, a context menu, window blur and a move with no buttons down all end a drag; Escape is stopped in the capture phase so the active tool never sees it.
- The drag, animation and hooks have no automated tests; the pure modules do. Check Escape, right-click, a short window and grabbing mid-animation by hand.

## Verification

- `pnpm turbo run test --filter=@shift/editor`
- `pnpm profile:desktop --scenario toolbar-drag --font <path>` for drag frame times and renders per commit
- `pnpm typecheck` and `pnpm lint:check`

## Related

- `Editor` mounts `FloatingToolbar` inside the canvas panel in `apps/desktop`, which must be positioned and `overflow: hidden`.
