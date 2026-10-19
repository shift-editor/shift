<!-- reviewed: 2026-10-19 review-every: 90d -->

# Floating Toolbar

The tools bar that floats over the canvas, docked to an edge the user picks by dragging its handle.

## Architecture Invariants

> **Architecture Invariant:** The bar's pose is a pure function of its dock, and a carried bar keeps the pose of the slot it was picked up from for the whole drag. `poseForDock` maps top and bottom to `flat` and both side docks to `stand`, so crossing between the two sides never turns the bar. Pose and placement change only on release. If the bar re-posed while the pointer moved, its footprint would change under the pointer and feed back into which edge is nearest.

> **Architecture Invariant:** The target is decided by where the carried bar is, and the target already chosen is among the docks that claim it whenever any dock does, so a held pointer settles on its first step and never flickers. When no dock claims, the target is held unchanged, or the first dock the frame has room for if it no longer fits. Each dock the frame has room for owns a region of the frame: the strip beside the centre square, with each corner rectangle split on its diagonal so a point goes to the edge it is proportionally nearer (`dockRegionAt`). The near half of each corner rectangle, on both sides, is caught early instead: it belongs to the edge across the seat's axis, which a flat bar's corner gives to the left or right edge and a standing bar's to the top or bottom, so a handle hugging an edge does not wait for the diagonal. The far corner of that rectangle sits exactly on the diagonal. A quarter of the corner rectangle moved the periphery by only a few points, and three quarters moved it a lot but made the landing depend most on the carried bar. The centre square, as wide as the bar is long, splits in half across the axis the bar was carried along: a bar from a left or right seat gets a left and a right half, one from a top or bottom seat a top and a bottom half. Along its own axis the bar therefore claims its next edge at the square's midline, not at its far side, and the other axis does not matter inside the square (`dockRegionAt` takes the seat dock). A quarter split, where the cross-axis edges also claim by half, claims no earlier, because the current target still wins ties, and it adds flips on left-to-right pulls. A dock claims the bar when its leading point is in its region, and the leading end differs by direction: the handle leads toward the bottom and right, while the bar's tip, the handle reflected through the bar's centre (`toolbarBarTip`), leads toward the top for a standing bar and toward the left for a flat one, the sides it faces, because the handle trails there. The tip takes a dock only once it is a `REGION_MARGIN` deep in that region (the point itself and the four points a margin away along each axis, not the corners of that square), so brushing a region's edge does not start a claim, and a tip claim beats a handle claim, so the far end switches the target as soon as it has arrived. A tip hanging off the canvas needs no special case: the regions treat a point past an edge as lying past that edge, so clamping it to the canvas first made no difference to any decision on four canvas shapes. The current target claims with a `REGION_MARGIN` (half the bar's thickness), so a shaking pointer cannot flip it across a diagonal or the midline. The margin only moves where a switch happens, not how stable it is: with none the target chatters about nine times per jittering pull, and a full unit of thickness makes every switch later. Judging by the bar's centre alone makes the bottom and right late or unreachable for a standing bar, because its centre hangs about half a bar length behind the handle; judging by the handle alone makes the top and left late, because the tip is a bar length ahead of it. Steering by both ends without a fixed leader is what made the target flicker: each end held a different dock and the next step handed the bar back.

> **Architecture Invariant:** The dock (the `dock` prop, or the bar's own state when unset) is the user's intent; the displayed dock is derived. `fitDockToFrame` shows a side dock on the bottom edge when the canvas is too short to hold the bar standing, and `onDockChange` fires only when the user drops the bar somewhere. The bar stores nothing; the desktop app remembers the dock (`useToolbarDock`). Writing the fitted dock back would forget the user's side choice every time a panel is resized.

> **Architecture Invariant:** The tools' opacity dip during a turn is keyed to the turn's progress, not to the clock. `springEasing(...).timeAtProgress` converts "20% to 50% of the way round" into animation offsets. A spring covers most of its distance early, so a dip centred on half the duration lands on the final stretch of the turn.

> **Architecture Invariant:** Where the handle sits inside the bar is measured from layout offsets at press and carried in `ToolbarDragState.handleInBar`; it is never hard-coded from the CSS padding. Layout offsets ignore a slide or turn that is still settling, so the bar can be grabbed mid-animation without a jump.

## Codemap

```
ui/
├── FloatingToolbar.tsx   — overlay, target edge line and landing outline, wires the hooks to the bar
├── ToolbarZonesOverlay.tsx — debug view of the dock regions, centre square halves, the carried bar with its handle and tip, their margins and the docks claiming it
├── ToolbarBar.tsx        — the bar itself, FLIP slide and turn about the handle, tools dip
├── ToolsPane.tsx         — the tool buttons and their menus, in either orientation
├── useToolbarDrag.ts     — pointer tracking and the guards that always end a drag
├── useToolbarMetrics.ts  — measured canvas and bar size
├── toolbarDrag.ts        — drag state transitions: tether, region steering, lift
├── toolbarPose.ts        — dock to pose, which docks fit, the shown dock
├── toolbarGeometry.ts    — dock regions, centre square halves and handle clamping
├── toolbarPresence.ts    — the turn's tools dip keyframes
└── springEasing.ts       — a spring baked into a CSS `linear()` easing
```

## Key Types

- `ToolbarDock`: the edge slot. `ToolbarPose`: `flat` (row, handle at the right end) or `stand` (column, handle at the bottom); the handle is the pivot, so the bar swings between 9 and 12 o'clock.
- `ToolbarDragState`: everything a drag in progress knows. `tether` is non-null while the bar is still held in its slot; `target` is where it lands on release.

## How it works

A drag starts tethered: the bar stays in its slot until the pointer has moved `TEAR_DISTANCE` (half the bar's thickness), then follows the pointer with the handle clamped inside the frame. The rest of the bar may overflow, and the panel clips it. The bar lifts for the whole drag. Once it is loose, a thin accent line runs along the target edge with a dashed outline where the bar will sit. The tools stay fully visible for the whole drag: dimming them as the bar neared a target added noise without telling the user anything the edge line and outline do not. They dip only through the turn itself, on release.

On release `useToolbarDrag` calls `onDock(releasedDock(…))`: the drag's target, or the opposite edge (`oppositeDock`) when this is the second press within `DOUBLE_PRESS_MS` that never tore the bar loose. Presses are paired in the hook rather than with `dblclick`, because the cover laid over the window on the first press takes the second click. `ToolbarBar` sees the new slot and pose, lays itself out in the new place at once, and animates a slide and a turn from where it was drawn, with the tools dipping through the turn.

## Workflow recipes

### Changing the bar's size or padding

1. Edit the classes in `ToolbarBar`; the handle offset and bar length are measured, so they follow.
2. If the thickness changes, update `BAR_THICKNESS` and the `w-12` and `h-12` classes in `ToolbarBar`.
3. Verify: `pnpm turbo run test --filter=@shift/editor`, then drag the bar to every edge by hand.

## Gotchas

- `TOOLBAR_INSET` and the Tailwind `inset-3` in `SLOT_FRAME` are the same 12px written twice. Change both.
- The bar is deliberately unpositioned so it and its handle share the wrapper as offset parent, which makes the `offsetLeft` subtraction exact and unaffected by a running turn. With `relative` the handle would measure from the bar instead, skewing `handleInBar` by the bar's position and border.
- Ctrl+click opens the macOS context menu, which swallows the release, so the press is ignored. Escape, a context menu, window blur and a move with no buttons down all end a drag; Escape is stopped in the capture phase so the active tool never sees it.
- Dragging straight through the middle, such as left to right, switches the target at the square's midline plus the margin, and a standing bar keeps its pose on the way. Splitting the square by the same axis for every seat instead makes pulls across it flip, because the handle travels off the square's centreline, so the split follows the seat. Releasing over the square lands on the half the handle is in, unless the bar's tip has reached a strip and claimed that edge instead. The tip is about a bar length from the handle, so the halves decide only where the handle is near the far side of the square: a flat bar's handle at its right end, a standing bar's at its bottom.
- The corner rectangles make the destination depend on the seat: the same handle in a corner catches the left edge for a flat bar and the top for a standing one. Giving a corner to the side edges for every seat removes that, but it leaves a standing bar's periphery late, with the top edge claiming at 61% and 84% of the path instead of 31% and 42%. Catching a whole corner rectangle's worth instead of half turns more of the periphery early but makes the landing depend still more on the bar that is carried.
- Where the same handle position lands still depends on which bar is carried: the tip is a bar length from the handle, in a different direction for a flat and a standing bar. A standing bar whose handle is high in a side strip has its tip in the top corner and targets the top; it targets the side only once the handle is low enough for the tip to be in the strip too. A flat bar whose handle is in the left part of the top or bottom strip targets the left for the same reason. That is the price of the facing sides activating as early as the others; the handle alone would not differ but makes the top and left late.
- The drag, animation and hooks have no automated tests; the pure modules do. Check Escape, right-click, a short window and grabbing mid-animation by hand.

## Verification

- In a development build, Debug → Toolbar Dock Zones draws each dock's region, the two halves of the centre square for the seat's axis, and, while dragging, the carried bar, its handle and tip joined by a line, a `REGION_MARGIN` cross around each marking the points tested, the docks that claim the bar now (thick outline, `claims` label) and the target they resolve to. It is mounted only while toggled on and is never persisted, so profiling runs start without it.

- `pnpm turbo run test --filter=@shift/editor`
- `pnpm profile:desktop --scenario toolbar-drag --font <path>` for drag frame times and renders per commit
- `pnpm typecheck` and `pnpm lint:check`

## Related

- `Editor` mounts `FloatingToolbar` inside the canvas panel in `apps/desktop`, which must be positioned and `overflow: hidden`.
