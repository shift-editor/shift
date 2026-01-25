# Scratchpad for Small Changes
* ~~selection bounds should be per type (e.g bezier bounds is not simply the bbox of its points)~~ - Fixed 2025-01-25: Implemented segment-aware bounds using Curve.bounds()
* ~~not using our Vec libraries enough e.g in resize, `const newX = anchorPoint.x + (point.x - anchorPoint.x) * sx;`~~ - Fixed 2025-01-25: Refactored 30+ occurrences to use Vec2 ops, migrated API to Point2D
