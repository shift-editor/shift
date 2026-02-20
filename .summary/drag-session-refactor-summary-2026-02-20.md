# Drag Session Refactor Summary (2026-02-20)

## Goal

Replace Select translate drag behavior from incremental preview rebasing to a deterministic drag-session model, and hard-cut rules API naming to the new constraint-oriented surface.

## Scope Completed

- Select translate path only (resize/rotate preview lifecycle left as-is).
- Editor/tool drag lifecycle redesign.
- Rules package API hard cut (`applyRules`/`matchRule` -> `constrainDrag`/`pickRule`).
- Follow-up performance pass to remove per-frame deep glyph cloning in rules.

## Major Changes

### 1) Tool-facing editor API: drag sessions

- Added `DragTarget`, `DragUpdate`, `DragSession`, and `beginDrag(...)` in:
  - `apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts`
  - Re-exported via `apps/desktop/src/renderer/src/lib/tools/core/index.ts`
- Removed translate dependency on tool-facing `applySmartEdits(...)` and `resetPreviewToStart()` from `EditorAPI`.

### 2) Editor drag-session implementation

- Added editor-managed active drag context and lifecycle in:
  - `apps/desktop/src/renderer/src/lib/editor/Editor.ts`
- Lifecycle implemented:
  - `beginDrag(target, startPointer)`
  - per-frame update from `fromStart = pointer - startPointer`
  - `commit` records one `SnapshotCommand`
  - `cancel` restores baseline snapshot
- Undo/redo now cancels active drag first to avoid mixed states.

### 3) Select translate behavior migration

- Rewrote translate behavior to call `session.update/commit/cancel` directly:
  - `apps/desktop/src/renderer/src/lib/tools/select/behaviors/TranslateBehavior.ts`
- Removed translate preview transaction actions (`moveSelectionDelta`, commit/cancel preview path for translate).
- Updated translate state to store `DragSession`:
  - `apps/desktop/src/renderer/src/lib/tools/select/types.ts`

### 4) Select action contract cleanup

- Removed `moveSelectionDelta` action and handler from:
  - `apps/desktop/src/renderer/src/lib/tools/select/actions.ts`
- Updated tests accordingly:
  - `apps/desktop/src/renderer/src/lib/tools/select/actions.test.ts`
  - `apps/desktop/src/renderer/src/lib/tools/select/Select.test.ts`

### 5) Testing/mocks support for drag sessions

- Added mock drag service (`beginDrag`, `update`, `commit`, `cancel`) and wired into `createMockToolContext`:
  - `apps/desktop/src/renderer/src/testing/services.ts`

### 6) Rules package hard cut rename

- Renamed public API and types:
  - `applyRules` -> `constrainDrag`
  - `matchRule` -> `pickRule`
  - `RulesResult` -> `DragPatch`
- Updated exports and docs:
  - `packages/rules/src/index.ts`
  - `packages/rules/src/types.ts`
  - `packages/rules/README.md`
  - `packages/rules/src/matcher.ts`
  - `packages/rules/src/actions.ts`
  - `packages/rules/src/rules.test.ts`

### 7) Solver architecture follow-up (performance)

- First pass switched rules to a draft-first model by cloning glyph per frame.
- Final pass removed per-frame deep clone to reduce drag-time allocation pressure.
- Final contract:
  - Callers apply raw point translation first.
  - `constrainDrag` runs on current draft glyph and returns constraint patch.
  - Intra-frame dependency resolution uses lightweight point update map (not full glyph clone).
- Updated caller flows:
  - `apps/desktop/src/renderer/src/lib/editor/Editor.ts` (raw updates, then constraints)
  - `apps/desktop/src/renderer/src/engine/editing.ts` (`applySmartEdits` raw-first then constraints)

## Behavioral Outcomes

- Deterministic drag updates from stable baseline + `fromStart`.
- One undo entry per committed drag.
- Cancel restores exact baseline.
- Translate no longer depends on preview rebasing action payloads.
- Rules API now reflects drag-constraint semantics directly.

## Validation Run

- `pnpm --filter @shift/rules test` passed.
- `pnpm --filter @shift/rules typecheck` passed.
- `pnpm --filter @shift/desktop test -- src/renderer/src/lib/tools/select/Select.test.ts src/renderer/src/lib/tools/select/actions.test.ts` passed.
- `pnpm --filter @shift/desktop test -- src/renderer/src/lib/tools/core/StateDiagram.compliance.test.ts` passed.
- `pnpm --filter @shift/desktop typecheck` passed.

## Non-goals / intentionally unchanged

- Resize and rotate still use existing preview transaction flow.
- No compatibility alias layer retained for old rules API names.
