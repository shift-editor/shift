# Scratchpad for Small Changes

- ~~selection bounds should be per type (e.g bezier bounds is not simply the bbox of its points)~~ - Fixed 2025-01-25: Implemented segment-aware bounds using Curve.bounds()
- ~~not using our Vec libraries enough e.g in resize, `const newX = anchorPoint.x + (point.x - anchorPoint.x) * sx;`~~ - Fixed 2025-01-25: Refactored 30+ occurrences to use Vec2 ops, migrated API to Point2D
- probably should provide a way to batch command executions
- (this.state as any).anchor.pointId = pointId; do not like this pattern in tools
- getMiddlePointAt?(pos: Point2D): { contourId: ContourId; pointId: PointId; pointIndex: number } | null; why is this optional?
- handling interactions that enter the edges of the canvas
  - drag interactions should start panning the canvas in that direction
  - if we have interactive drawing (pen) it should just go away and come back if we mouse back in
- if you pan wtih trackpad and are actively marquees, pen etc it shhould also move the mouse
-
