<!-- reviewed: 2026-10-17 review-every: 90d -->

# Floating Toolbar

The tools bar that floats over the canvas, docked to an edge the user picks by dragging its handle.

## Architecture Invariants

> **Architecture Invariant:** The bar's pose is a pure function of its dock, and a carried bar keeps the pose of the slot it was picked up from for the whole drag. `poseForDock` maps top and bottom to `flat` and both side docks to `stand`, so crossing between the two sides never turns the bar. Pose and placement change only on release. If the bar re-posed while the pointer moved, its footprint would change under the pointer and feed back into which edge is nearest.

> **Architecture Invariant:** Whichever reaches a new zone first, the pointer or the carried bar's reach point (`TRAILING_REACH` of the way in from the end away from the handle), picks the target edge, and some edge is always the target. The zones: the top and bottom quarters of the frame dock to their edge, and the outer thirds of the band between dock to their side (a short frame splits into top and bottom halves). The centre third of the band belongs to no zone and keeps whatever the target already is, so wobbling across the middle never flips the bar between sides. A point only claims a new zone once it is `ZONE_MARGIN` clear of the current target's zone. The handle sits at one end of the bar, so the pointer leads in some directions and trails in others. Steering by the pointer alone makes the trailing directions late, because the whole bar has crossed before the pointer does. Steering by a point on the bar alone makes the leading directions late, and can leave a zone out of reach: the handle is clamped inside the frame, so on a short canvas a standing bar's far end cannot get into the bottom quarter. Taking whichever arrives first switches every direction once at most `TRAILING_REACH` of the bar is in. The reach point is a fixed offset from the handle because the carried bar keeps its pose.

> **Architecture Invariant:** The dock (the `dock` prop, or the bar's own state when unset) is the user's intent; the displayed dock is derived. `fitDockToFrame` shows a side dock on the bottom edge when the canvas is too short to hold the bar standing, and `onDockChange` fires only when the user drops the bar somewhere. The bar stores nothing; the desktop app remembers the dock (`useToolbarDock`). Writing the fitted dock back would forget the user's side choice every time a panel is resized.

> **Architecture Invariant:** The tools' opacity dip during a turn is keyed to the turn's progress, not to the clock. `springEasing(...).timeAtProgress` converts "20% to 50% of the way round" into animation offsets. A spring covers most of its distance early, so a dip centred on half the duration lands on the final stretch of the turn.

> **Architecture Invariant:** Where the handle sits inside the bar is measured from layout offsets at press and carried in `ToolbarDragState.handleInBar`; it is never hard-coded from the CSS padding. Layout offsets ignore a slide or turn that is still settling, so the bar can be grabbed mid-animation without a jump.

## Codemap

```
ui/
├── FloatingToolbar.tsx   — overlay, target edge line and landing outline, wires the hooks to the bar
├── ToolbarZonesOverlay.tsx — debug view of the dock zones, target margin, reach point, pointer and handle
├── ToolbarBar.tsx        — the bar itself, FLIP slide and turn about the handle, tools dip
├── ToolsPane.tsx         — the tool buttons and their menus, in either orientation
├── useToolbarDrag.ts     — pointer tracking and the guards that always end a drag
├── useToolbarMetrics.ts  — measured canvas and bar size
├── toolbarDrag.ts        — drag state transitions: tether, zone steering, lift, tools opacity
├── toolbarPose.ts        — dock to pose, which docks fit, the shown dock
├── toolbarGeometry.ts    — dock zones and handle clamping
├── toolbarPresence.ts    — tools opacity constants and the turn's dip keyframes
└── springEasing.ts       — a spring baked into a CSS `linear()` easing
```

## Key Types

- `ToolbarDock`: the edge slot. `ToolbarPose`: `flat` (row, handle at the right end) or `stand` (column, handle at the bottom); the handle is the pivot, so the bar swings between 9 and 12 o'clock.
- `ToolbarDragState`: everything a drag in progress knows. `tether` is non-null while the bar is still held in its slot; `target` is where it lands on release.

## How it works

A drag starts tethered: the bar stays in its slot until the pointer has moved `TEAR_DISTANCE` (half the bar's thickness), then follows the pointer with the handle clamped inside the frame. The rest of the bar may overflow, and the panel clips it. The bar lifts for the whole drag. Once it is loose, a thin accent line runs along the target edge with a dashed outline where the bar will sit, and the tools dim while that target would turn the bar.

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
- The drag, animation and hooks have no automated tests; the pure modules do. Check Escape, right-click, a short window and grabbing mid-animation by hand.

## Verification

- In a development build, Debug → Toolbar Dock Zones draws each zone, the target's zone grown by `ZONE_MARGIN`, and the pointer, reach point and handle while dragging. It is mounted only while toggled on and is never persisted, so profiling runs start without it.

- `pnpm turbo run test --filter=@shift/editor`
- `pnpm profile:desktop --scenario toolbar-drag --font <path>` for drag frame times and renders per commit
- `pnpm typecheck` and `pnpm lint:check`

## Related

- `Editor` mounts `FloatingToolbar` inside the canvas panel in `apps/desktop`, which must be positioned and `overflow: hidden`.
