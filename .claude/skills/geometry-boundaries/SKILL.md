# /geometry-boundaries — Package-First Glyph Geometry

Use when touching glyph geometry, contour traversal, segment parsing, sidebearings, or bounds.

## Policy

- `@shift/geo`: primitive/domain-agnostic math only.
- `@shift/font`: glyph-domain geometry (`iterateRenderableContours`, `parseContourSegments`, `deriveGlyphTightBounds`, `deriveGlyphXBounds`).
- App layer: behavior/orchestration only (selection, hover, command semantics).

## Rules

1. Check `@shift/font` first before adding helpers.
2. Do not create fake point IDs for geometry-only operations.
3. Do not add app-local duplicates of contour iteration, segment parsing, or glyph bounds derivation.
4. Keep ID-aware logic separate from geometry-only code.

## Verification

```bash
pnpm --filter @shift/font test
pnpm --filter @shift/desktop test -- sidebearings.test.ts rendering/render.test.ts rendering/passes/glyph.test.ts
pnpm lint:check
```
