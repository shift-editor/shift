# Agent Log

## 2026-03-01 — Tool System Refactor (handlers hard-cut)

### Completed
- Removed legacy behavior bridge from runtime path.
  - Deleted use of `LegacyBehavior` / `adaptLegacyBehavior` in tool registrations.
  - `select`, `pen`, `text`, `hand`, `shape` now register native `Behavior<...>` handlers directly.
- Converted remaining legacy behaviors to explicit handler methods.
  - `onPointerMove`, `onClick`, `onDoubleClick`, `onDragStart`, `onDrag`, `onDragEnd`, `onDragCancel`, `onKeyDown`, `onKeyUp`.
  - Preserved bend, translate, resize, rotate, marquee, pen handle/anchor semantics.
- Kept bend behavior working in new system and validated via existing select bend tests.
- Removed `selectionChanged` path (per user direction) and kept explicit emitted event handling coverage.

### API updates
- Added event alias in gesture layer:
  - `ToolEventOf<T extends ToolEvent["type"]>` in `GestureDetector.ts`.
- Replaced verbose `Extract<ToolEvent, { type: ... }>` usage across tool code with `ToolEventOf<...>`.
- Reordered behavior handler signature to support omitting unused events:
  - **Old:** `(state, event, ctx)`
  - **New:** `(state, ctx, event)`
- Reordered state hooks similarly:
  - **Old:** `onStateEnter(prev, next, event, ctx)` / `onStateExit(prev, next, event, ctx)`
  - **New:** `onStateEnter(prev, next, ctx, event)` / `onStateExit(prev, next, ctx, event)`
- Updated `BaseTool` dispatch to call handlers in new argument order.

### Style cleanup requested by user
- Removed underscore-unused-parameter style from runtime tool code.
- With new trailing-event signature, handlers that do not need event now omit it entirely (no `_event`, no `void event`).

### Verification run (green)
- `pnpm --filter @shift/desktop typecheck`
- `pnpm --filter @shift/desktop test --reporter=dot`
- Result: `57` test files passed, `807` tests passed.

### Notes for next agent
- Docs under `apps/desktop/src/renderer/src/lib/tools/docs/` may still contain stale wording about legacy transition/action patterns; `RFC_TOOL_SYSTEM_REFACTOR.md` has been partially aligned to new signature order.
- Repo contains unrelated in-progress changes outside this refactor; do not reset/revert broadly.
