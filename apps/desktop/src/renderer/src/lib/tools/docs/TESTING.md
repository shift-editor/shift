# Tool system testing

## Strategy

Tests are split into **unit**, **contract**, and **pipeline** layers so behavior is covered at the right level and regressions are caught where they occur.

### Unit tests (tool in isolation)

- **What**: A single tool instance with a mock `ToolContext` (`createMockToolContext()`). No `ToolManager` or `GestureDetector`.
- **How**: Instantiate the tool, call `handleEvent()` with `ToolEvent` objects (or use `ToolEventSimulator` to send drag/pointer sequences).
- **Use for**: State transitions, action execution, selection/command side effects, edge cases (modifiers, non–left click, etc.).
- **Examples**: `Pen.test.ts`, `Select.test.ts` (most tests).

### Contract tests (BaseTool lifecycle)

- **What**: Asserts the shared contract of `BaseTool.handleEvent`: transition → set state → `setActiveToolState` → `onTransition` only when the new state is a different reference.
- **How**: A minimal tool with a known transition and a spy on `onTransition` and `setActiveToolState`. No real tool logic.
- **Use for**: Ensuring all tools get correct lifecycle (no `onTransition` when state ref is unchanged).
- **Examples**: `BaseTool.contract.test.ts`.

### Pipeline tests (ToolManager + pointer)

- **What**: Full path: pointer events → `ToolManager.handlePointerDown/Move/Up` → `GestureDetector` → `ToolEvent[]` → active tool `handleEvent`.
- **How**: Create `ToolManager` with mock context, register tools, call `handlePointerDown`, `handlePointerMove` (flush rAF if testing drag), `handlePointerUp`. Assert `activeToolState` or editor side effects.
- **Use for**: Tap vs drag detection, correct tool receiving click/drag, no broken state after gesture.
- **Examples**: `ToolManager.test.ts` → "pipeline (pointer → gesture → tool)".

### Outcome tests (state/event → next state)

- **What**: For key (state, event) pairs, assert the **exact** next state (type and key fields). Complements state diagram compliance (which only checks result is in the diagram).
- **How**: Instantiate tool with mock context, call `tool.transition(state, event)`, assert `result.type` and state-specific fields (e.g. dragging has `screenStart`, `startPan`).
- **Use for**: Regressions when refactoring transition logic or behaviors; documenting expected outcomes.
- **Examples**: `Hand.outcome.test.ts`, `Shape.outcome.test.ts`.

## Tap vs drag in tests

- **Tap (user clicked, no drag)**
  Prefer a single **click** event when the scenario is “user clicked here”:
  - `sim.click(x, y)` (sends one `{ type: "click", point, shiftKey, altKey }`), or
  - `tool.handleEvent({ type: "click", point: { x, y }, shiftKey, altKey })`.

  Avoid simulating tap as `dragStart` + `dragEnd`; that can hide bugs where the tool treats tap and drag the same.

- **Drag**
  Use `ToolEventSimulator`: `sim.onMouseDown()`, `sim.onMouseMove()`, `sim.onMouseUp()` so the tool receives `dragStart`, `drag`, `dragEnd`.

## Mock context

`createMockToolContext()` returns a `MockToolContext` that implements `ToolContext` and exposes:

- All `ToolContext` methods/signals used by tools.
- `mocks`: spies and sub-services (e.g. `mocks.commands`, `mocks.selection`) for assertions.
- `fontEngine`, `getGlyph()`, hit-test helpers keyed off `fontEngine.$glyph.value`.

Keep the mock aligned with `ToolContext`: when the interface gains a method, add it to the mock so tool tests keep type-checking and reflecting real usage.
