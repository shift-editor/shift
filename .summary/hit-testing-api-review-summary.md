# Hit Testing API Review Summary

Date: 2026-02-20

## What was done

- Reviewed the existing plan at `.plans/hit-test-api-design.md` for API ergonomics and clarity.
- Audited the current implementation and call sites across editor, hit-result types, hover manager, select behaviors, pen behaviors, and tool-facing `EditorAPI`.
- Identified key inconsistencies and friction points in the current design:
  - Two separate entry points for cursor resolution (`getNodeAt` vs `hitTestBoundingBoxAt`).
  - Parallel result shapes (`HitResult` vs `HoverResult`) with overlapping responsibility.
  - Editor-level dependency on select-tool utility modules for primitive hit/rect helpers.
  - Mixed usage of high-level and low-level hit-test methods.
  - Plan path references were slightly outdated (helpers currently live under `lib/tools/select/*`).

## Planning outcomes produced

Two concrete plan iterations were produced:

1. A compatibility-preserving direction:
   - Introduce a canonical `getHitAt` API.
   - Keep `getNodeAt` temporarily as a glyph-only compatibility shim.
   - Derive hover from canonical hits.

2. A full replacement direction (after user requested no backwards compatibility):
   - Remove legacy hit-test entry points and old hover result model.
   - Replace with a single `getHitAt` API and one `HitResult` union.
   - Move primitive hit helpers into `lib/hitTest/*`.
   - Rewrite all tool call sites to consume the new API directly.
   - Delete old select-tool utility/hit-test modules.

## Notes on repository changes so far

- No production code was modified yet.
- This summary file was created to capture completed analysis and the proposed implementation direction.
