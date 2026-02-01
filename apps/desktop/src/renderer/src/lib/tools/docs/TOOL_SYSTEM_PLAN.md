# Tool system and testing overhaul (unified plan)

Single plan covering: **(1) API/state machine design**, **(2) testing and regressions**, and **(3) ergonomics**—making it easier to create new tools, add to existing ones, and reason about behavior.

---

## Current friction (why improve)

**Creating a new tool today:** Edit `ToolName` in createContext.ts → create tool class (id, $cursor, initialState, transition, optionally activate/deactivate/onTransition/render, stateSpec) → register in tools.ts with icon/tooltip → wire shortcut elsewhere. Doc example is incomplete (no ToolName, $cursor, registration). Two patterns (simple Hand/Shape vs behavior-based Pen/Select) with no “when to use which.”

**Adding to a tool:** New state = update union + stateSpec + transition (or behaviors) + possibly intents. Behavior order is implicit (array order); “first canHandle wins” is not in the type. Intent execution differs (Pen runs in tool onTransition; Select uses shared executeIntent).

**Reasoning:** “What happens on click?” spans GestureDetector → ToolManager → handleEvent → transition → onTransition → intent. No single event-flow doc. State diagram is documentation only; code can drift.

---

## Phase 1 – API and state machine cleanup

Goal: Stabilize the tool contract so tests and mocks can rely on it.

- **1.1 Document the tool contract** (DOCS or CONTRACT.md): idle rule, lifecycle (activate/deactivate are not ToolEvent), transition purity, onTransition side-effects-only (no mutating this.state).
- **1.2 Remove Pen state mutation** in executePenIntent (placePoint): no `(this.state as any).anchor.pointId = pointId`. Use single assignment after intent execution (e.g. setActiveToolState + this.state = same object).
- **1.3 Make Hand transition pure**: move setPan/requestRedraw into onTransition; transition only returns updated state.
- **1.4 Unify behavior API**: document behavior signature; PenBehavior.render → DrawAPI or remove; one contract for both tools.
- **1.5 (Optional) Centralize idle in BaseTool**: early return in handleEvent when state.type === "idle"; remove idle branches from Pen/Select/Hand/Shape.

---

## Phase 2 – Narrow tool dependency surface

- **2.1 Define ToolContext interface**: only what tools use (hitTest, edit, selection, preview, commands, cursor, render, zone, activeToolState, setActiveToolState, getScreenMousePosition, tools, hitRadius, pan/setPan if needed). Editor implements it; document.
- **2.2 Mock implements ToolContext**: createMockToolContext return type satisfies ToolContext so mocks stay aligned.

---

## Phase 3 – Testing

- **3.1 BaseTool contract tests**: assert lifecycle (transition → setActiveToolState → onTransition with correct prev/next; no onTransition when same reference).
- **3.2 Pipeline integration tests**: drive ToolManager with handlePointerDown/Move/Up; assert active tool state and/or editor side effects (tap vs drag).
- **3.3 Use click for “tap” in tool tests**: where intent is “user clicked,” send one handleEvent({ type: "click", ... }) or sim.click(); add ToolEventSimulator.click() if needed.
- **3.4 Document test strategy**: unit vs pipeline vs contract in DOCS or TESTING.md.

---

## Phase 4 – Optional hardening

- State diagram compliance tests (transition result in diagram).
- Typed activeToolState per tool (registry type).

---

## Phase 5 – Ergonomics (create, extend, reason)

Goal: Make the tool state machine easy to create new tools with, add things to, and reason about.

### 5.1 Discoverability and onboarding

- **Single “Creating a new tool” checklist** in DOCS:
  1. Add tool id to ToolName (createContext.ts) or document self-registration if introduced.
  2. Create tool class: implement id, $cursor (or use default – see 5.2), initialState, transition; optionally activate, deactivate, onTransition, render, handleModifier, stateSpec.
  3. Register in tools.ts: editor.registerTool(id, ToolClass, Icon, tooltip).
  4. Wire keyboard shortcut (store or keybind layer).
  5. **When to use behaviors**: “Use a single transition() when states/events are few (e.g. Hand, Shape). Use the behavior pattern when you have many (state, event) handlers or want to split by concern (e.g. Pen, Select).”
  6. **When to use intents**: “Use intents when the same state change can trigger different side effects (e.g. close vs continue contour); transition returns state + optional intent, onTransition executes intent.”
- **Complete minimal example** in DOCS: include ToolName update, $cursor (or default), registration, and one transition; note that activate() should set state (e.g. to "ready") so the tool reacts to events.
- **Event flow one-pager**: one diagram or section: “Pointer → InteractiveScene → ToolManager.handlePointer\* → GestureDetector → ToolEvent[] → activeTool.handleEvent → transition → onTransition (and intent execution).” So “where does X happen?” is answerable.

### 5.2 Reduce boilerplate for new tools

- **Default $cursor for simple tools**: In BaseTool, add an optional default: if the subclass does not override a cursor getter/setter, use a computed that returns `{ type: "default" }`. Then Hand/Shape (and future simple tools) can omit defining $cursor unless they need state-based cursor. Alternatively, introduce `getCursor(state: S): CursorType` and BaseTool builds `$cursor`from`computed(() => this.getCursor(editor.activeToolState.value as S))` so tools implement one method instead of a computed + activeToolState cast.
- **Idle handling in BaseTool** (if 1.5 done): New tools don’t need to remember to short-circuit idle; one place to look.

### 5.3 Reasoning: behavior order and intent

- **Document behavior semantics** in DOCS: “Behaviors are tried in array order. First behavior for which canHandle(state, event) is true wins; its transition() is used. Order matters when multiple behaviors could handle the same (state, event).”
- **Unify intent execution** (optional): Same pattern for Pen and Select—e.g. in BaseTool or a shared helper: “if next has an intent property, call executeIntent(next.intent, context) in onTransition.” So “where are intents run?” has one answer. Document in DOCS.

### 5.4 Extensibility: adding states and behaviors

- **“Adding a state” checklist** in DOCS: (1) Add variant to state union, (2) Add to stateSpec.states and transitions, (3) Add transition branches (or a new behavior), (4) If side effects, add onTransition branch or intent + executeIntent case.
- **“Adding a behavior” checklist**: (1) Implement Behavior interface (canHandle, transition, optional onTransition/render), (2) Insert in tools’ behaviors array at the right position (first match wins).
- **Optional: state diagram as source of truth**: Dev-only or test that transition(state, event).type is in stateSpec and (from, event, to) is in stateSpec.transitions so diagram and code can’t drift (already in Phase 4).

### 5.5 Add-tool API (single registration surface)

- **Goal**: Adding a new tool = one registration call (and one id in the ToolName union for type safety). No edit to the key handler in Editor.tsx.
- **Design**: (1) Registration descriptor: `editor.registerTool({ id: ToolName, ToolClass, icon, tooltip, shortcut?: string })`. Editor stores tool + metadata including optional shortcut. (2) Shortcut wiring: In Editor.tsx, replace the four key blocks with a single loop over `editor.getToolShortcuts()`; if `e.key === shortcut` and canvas is active, call `editor.setActiveTool(toolId)`. (3) ToolName stays a union; add tool = add id to union + one registerTool call in tools.ts. No edit to Editor.tsx.
- **Optional later**: ToolName could become `string` or a union from a const array of built-in ids so adding to the array updates the union.

---

## Suggested order of work

| Step    | What                                                                       |
| ------- | -------------------------------------------------------------------------- |
| 1.1     | Document contract                                                          |
| 1.2     | Pen: no state mutation                                                     |
| 1.3     | Hand: pure transition                                                      |
| 1.4     | Behavior API / render types                                                |
| 1.5     | (Optional) Idle in BaseTool                                                |
| 2.1–2.2 | ToolContext + mock                                                         |
| 3.1–3.4 | Contract, pipeline, click-for-tap tests, test docs                         |
| 5.1     | DOCS: “Creating a new tool” checklist, full minimal example, event flow    |
| 5.2     | Default $cursor or getCursor() to cut boilerplate                          |
| 5.3     | DOCS: behavior order, optional unified intent execution                    |
| 5.4     | DOCS: “Adding a state” / “Adding a behavior” checklists                    |
| 5.5     | Add-tool API: registerTool(descriptor), Editor.tsx uses getToolShortcuts() |
| 6.1     | All tools use behaviors: refactor Hand/Shape, add createBehavior helper    |
| 6.2     | Behavior order: outcome tests + optional priority on behaviors             |
| 4.x     | Optional: diagram compliance, typed activeToolState                        |

---

## Files to touch (summary)

- **Phase 1**: BaseTool.ts, Pen.ts, Hand.ts, pen/types.ts, tools/docs (DOCS.md or CONTRACT.md).
- **Phase 2**: New ToolContext (e.g. core/ToolContext.ts), Editor, testing/services.ts.
- **Phase 3**: New BaseTool.contract.test.ts, ToolManager.pipeline.test.ts (or block), Pen.test.ts, Select.test.ts, ToolEventSimulator, tools/docs (TESTING.md or DOCS).
- **Phase 5**: tools/docs/DOCS.md (checklists, example, event flow, behavior/intent semantics); optionally BaseTool.ts for default $cursor or getCursor().
- **Phase 6**: Hand.ts, Shape.ts (refactor to behaviors); core (createBehavior helper, optional priority on behavior interface); Pen/Select (add priority if desired); tests (outcome tests for key (state, event) pairs).

This plan tackles API soundness, regression safety, and ergonomics so the tool state machine is easier to create new tools with, add to, and reason about.
