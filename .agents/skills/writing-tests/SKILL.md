---
name: writing-tests
description: Canonical rules for writing tests in the Shift codebase. Use whenever you add, rewrite, or review a `.test.ts` or `.spec.ts` file — or any time you're about to mock, stub, or spy your way around a testing problem. Covers TestEditor-based tests and desktop E2E tests driven through EditorDriver.
---

# /writing-tests — How tests are written in this codebase

The goal is tests that survive a full rewrite of the implementation, as long as the behavior stays the same. If your test breaks when a private method is renamed or a call count changes, you're testing the wrong thing.

## The rule

**Assert on observable state, not on mock calls.**

Drive the code through its user-facing surface (`editor.copy()`, `editor.click()`, `toolManager.handleKeyDown(...)`) and assert on what a user would see — glyph contours, selection, viewport pan, tool state, command history, returned values. Never on "was method X called N times."

Everything else here is a consequence of that rule.

## When not to add a test

Do not treat line coverage or "every changed file needs a test" as the goal. Add a test only when it protects an observable behavior, domain invariant, or public boundary that could regress independently of the implementation.

Skip a new test when it would only:

- repeat declarative framework wiring, dependency setup, or static configuration;
- snapshot private query keys, option objects, CSS classes, component structure, or other implementation choices;
- exercise a trivial delegation whose behavior is already covered at the owning boundary;
- justify extracting a tiny helper solely so the implementation has something easy to unit-test;
- assert behavior already guaranteed by TypeScript, Rust's type system, or the library being configured;
- require mocks, spies, a parallel harness, or broad DOM/IPC infrastructure for code that is better verified by focused manual QA.

Examples: do not test that a `QueryClientProvider` is mounted, that a query key contains a particular string, or that a fixed-size chunk helper calls `slice()` correctly. Do test stable batching if it is exposed as a reusable contract with edge cases, or test the user-visible result through a real integration boundary when one exists.

When no worthwhile automated test exists, say so explicitly in the handoff and record the focused manual verification performed. Do not create a low-value test to make the diff look complete.

## Deleting or replacing tests

Tests follow behavioral ownership, not implementation names. Removing or replacing a class does not make its tests obsolete when another class now owns the same behavior.

Before deleting a test or materially reducing a test file, create a test migration ledger. For every removed `it()` or `test()` block, record:

1. The observable truth or domain invariant it protects.
2. The surviving or replacement test that protects that truth.
3. If there is no replacement, the intentionally removed product behavior that made the invariant obsolete.

Move replacement tests to the new behavioral owner before deleting the old file. Similar-looking coverage is not enough: verify that it exercises the same boundary, failure mode, and state transition. Report removed and replacement test counts in the handoff.

Example:

| Removed test                               | Protected invariant                                                                             | Replacement                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Draft cancel restores rule-expanded points | Cancellation restores every previewed position, including positions outside the initial targets | `GlyphLayerEdit.test.ts` multi-position cancellation test |
| Next draft starts from committed preview   | A finished edit becomes the base of the next interaction                                        | `GlyphLayerEdit.test.ts` sequential edit test             |

## If you're stuck, research — don't invent a mock

The moment you think "I'll just mock this out" is the moment to stop and look for prior art. Real Electron / font-editor / reactive-signal codebases have solved the same class of problem: VSCode, Obsidian, Signal Desktop, Bitwarden, Fontra, tldraw. Their patterns are on GitHub.

The `SystemClipboard` adapter in this repo came from a short WebSearch pass through VSCode's `IClipboardService` + `TestClipboardService` — not from inventing one locally. Ten minutes of searching usually beats an hour of mock wrangling, and the resulting test survives refactors because it mirrors a pattern that works in production code.

Rule of thumb: if the repo doesn't already show you a clean way to test this, the answer is probably "inject a boundary and test through it." Go find how someone else injected the boundary before reaching for `vi.mock`.

## When to stop and rethink

If you catch yourself doing any of the following, stop. You're about to write a test this codebase has deliberately deleted.

| Reaching for…                                                                                                                                               | What it means                                                                                                                                                   | Do instead                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vitest mock primitives** — `vi.fn`, `vi.spyOn`, `toHaveBeenCalled`, `mock.calls.length`, `.mock.calls`, execution-order arrays (`applied.push(...)`)      | Asserting on "was this called" instead of "what did the user see"                                                                                               | Find the user-facing consequence (state change, return value, emitted payload). If there isn't one, the behavior isn't worth a unit test. Exception: when you're testing a primitive whose **contract is the invocation count** (reactive library fire counts, pub/sub dispatch), a plain closure counter (`let n = 0; ...; n++`) is fine — don't reach for vitest mocks |
| **Hand-built events, states, or snapshots** — constructing `ToolEvent`s, `Coordinates`, `GlyphSnapshot`s inline so you can pass them straight into a method | Recreating the pipeline instead of using it                                                                                                                     | Drive through `TestEditor` — real gestures, real events, real state                                                                                                                                                                                                                                                                                                      |
| **Global stubs** — `vi.stubGlobal`, monkey-patching `window`, `requestAnimationFrame`, `electronAPI`                                                        | The code has an unmanaged global dependency; stubbing papers over it                                                                                            | Inject the boundary. For rAF: `toolManager.flushPointerMoves()`. For IPC: `SystemClipboard`-style adapter. If the boundary doesn't exist yet, add one                                                                                                                                                                                                                    |
| **Parallel-world test harnesses** — mock engines, mock renderers, mock command contexts, raw `new Editor(...)` in a `.test.ts`                              | Reimplementing production in TypeScript so the test can "look inside." Drifts from real behavior; the mock/prod divergence is the whole pain the repo swept out | Use `TestEditor`. If you can't, extract the logic into a pure function and test that. `new Editor(...)` in tests is enforced against by `oxlint no-raw-editor-in-tests`                                                                                                                                                                                                  |

## Test categories

| Category             | Use when                                                                   | Template in repo                                                                            |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Tool test**        | User-triggerable behavior of a tool (pointer, keyboard, selection, cursor) | `lib/tools/pen/Pen.test.ts`, `lib/tools/hand/Hand.test.ts`, `lib/tools/shape/Shape.test.ts` |
| **Command test**     | A `Command`'s execute/undo/redo round-trip                                 | `lib/commands/primitives/PointCommands.test.ts`                                             |
| **Pure module test** | Stateless class or function with no `Editor` dependency                    | `lib/tools/text/TextRunController.test.ts`, `lib/editor/hit/boundingBox.test.ts`            |
| **Bridge test**      | `NativeBridge` against the real Rust engine                                | `bridge/NativeBridge.test.ts`                                                               |
| **Desktop E2E test** | Behavior requiring the real renderer, DOM, Electron, or visual output     | `e2e/editor.spec.ts`, `e2e/tools.spec.ts`, `e2e/application-menu.spec.ts`                  |

If your target doesn't fit one of these, stop and ask — don't invent a new shape.

### Decision: which one

1. Does it require the real renderer, DOM, Electron, native menus, or visual output? → **Desktop E2E test** via `EditorDriver` and Playwright.
2. Can its behavior be observed completely through editor domain state after a click, drag, or key? → **Tool test** via `TestEditor`.
3. Is it a single command's undo/redo contract? → **Command test**.
4. Is it a pure function or pure class with no `Editor`? → **Pure module test**.
5. Is it the NAPI boundary? → **Bridge test**.

## Templates

### Tool test

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Hand tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("hand");
  });

  it("drag pans the viewport by the screen delta", () => {
    const startPan = editor.pan;

    editor.pointerDown(0, 0);
    editor.pointerMove(50, 30); // crosses drag threshold
    editor.pointerMove(120, 80);
    editor.pointerUp(120, 80);

    expect(editor.pan.x).toBe(startPan.x + 120);
    expect(editor.pan.y).toBe(startPan.y + 80);
  });
});
```

### Pure module test

```ts
import { describe, it, expect } from "vitest";
import { SnapPipelineRunner } from "./SnapPipelineRunner";

describe("SnapPipelineRunner", () => {
  const runner = new SnapPipelineRunner();

  it("point-to-point wins over a closer metrics candidate", () => {
    const result = runner.runPointPipeline(
      [
        pointStep("p2p", hit("pointToPoint", { x: 110, y: 110 })),
        pointStep("metrics", hit("metrics", { x: 101, y: 101 })),
      ],
      pointArgs,
    );

    expect(result.source).toBe("pointToPoint");
    expect(result.point).toEqual({ x: 110, y: 110 });
  });
});
```

Stub _inputs_ (a `PointSnapStep` here is an interface — build a minimal one). Never stub the class under test.

### Bridge test

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NativeBridge } from "./NativeBridge";
import { createBridge } from "@/testing/engine";

describe("NativeBridge session lifecycle", () => {
  let bridge: NativeBridge;

  beforeEach(() => {
    bridge = createBridge(); // real Rust engine via shift-node
  });

  it("startEditSession populates $glyph", () => {
    bridge.startEditSession("A");
    expect(bridge.hasSession()).toBe(true);
    expect(bridge.$glyph.peek()).not.toBe(null);
  });
});
```

### Desktop E2E test

```ts
import { workspaceTest as test, expect } from "./fixtures/electronApp";

test("moves a point and supports undo", async ({ editor }) => {
  await editor.openGlyphByName("A");
  const point = await editor.selectVisiblePoint();
  const before = await editor.pointPosition(point.id);

  await editor.dragPoint(point);
  expect(await editor.pointPosition(point.id)).toEqual(point.expectedGlyphPosition);

  await editor.undo();
  expect(await editor.pointPosition(point.id)).toEqual(before);
});
```

Use `EditorDriver` for semantic editor actions and domain observations. Keep assertions in the spec, and use Playwright's `page` only for visible UI, browser, or Electron behavior. Driver actions that can persist geometry own edit settling; confirmed reads such as `outline()` and `pointPosition()` must not be preceded by direct `editCoordinator.settled()` calls.

Coordinate spaces are explicit: pointer methods take page positions, `dragCanvas()` takes canvas-local positions, and projection helpers convert between scene, canvas, and page coordinates. `activeGlyph()` returns `null` until the scene node and authored layer are both published. After setup changes geometry or camera state, call `waitForCanvasRender()` before projections or pointer input; authored-layer readiness does not guarantee current canvas transforms or hit regions. Use `livePointPosition()` and `selectionBounds()` for gesture previews; keep `pointPosition()` for confirmed geometry.

Do not turn `EditorDriver` into a dumping ground. Native window/menu focus, variable-font construction, GPU residency, performance loops, and screenshot assertions remain at their owning fixture or spec boundary.

## The fake-test checklist

Before committing a test, run through these. Any miss means the test is wrong.

1. **Mental deletion.** Replace the method body under test with `throw new Error("unimplemented")`. Does your test fail? If it still passes, you wrote a tautology — usually because you asserted on a value you constructed rather than on a consequence.
2. **User-facing surface.** You drove through a method a real user can trigger (pointer, keyboard, command, menu action), not a `#private` field or a tool-internal method.
3. **Specific assertions.** `expect(editor.pointCount).toBe(4)` — yes. `expect(result).toBeDefined()` or `expect(spy).toHaveBeenCalled()` — no, those survive any implementation.
4. **Correct code path.** If the real production path goes through command history + bridge + signals, your test goes through those too. You didn't reach behind the facade.
5. **Focused body.** Keep unit-test bodies under roughly 15 lines. E2E flows may be longer when the visible workflow requires it, but each test still protects one behavior and repeated plumbing belongs in `EditorDriver` or the owning fixture.

## Setup discipline

- `beforeEach` is ≤ 5 lines: `new TestEditor()` + `startSession()` + `selectTool()` + optional fixture.
- No wrapper factories around `TestEditor`. If you need a reusable helper, it belongs as a method on `TestEditor` itself (see `pointerMove`, `click`, `escape`).
- If your test needs a pre-drawn shape, draw it with the pen/shape tool in `beforeEach` — don't construct glyph snapshots inline.
- In E2E specs, prefer the shared `editor` fixture over constructing `EditorDriver` for the primary page. Construct a driver directly only for additional workspace windows.
- Do not add one-off scene-node, glyph-layer, canvas-offset, or projection helpers when `EditorDriver` can express the same reusable boundary.
- Use raw Playwright gestures only when the low-level browser lifecycle is itself under test; otherwise use `pointerDown()`, `pointerMove()`, `pointerUp()`, `dragCanvas()`, or `cancelGesture()`.

## Naming

- `describe()` names should explain the behavior or contract under test, not just repeat a class or file name.
- Prefer `describe("glyph source geometry follows coordinate patches", ...)` over `describe("GlyphSourceState", ...)`.
- A class name can appear inside a larger phrase when it adds clarity, but the phrase should still tell the reader what invariant is being protected.

## When testing is genuinely hard

Some code resists clean unit testing — DOM event handlers, focus management, IME composition, React effect lifecycle.

**Default move: extract the non-DOM logic into a pure function and test that.** Example: `HiddenTextInput` keyboard handling → `lib/tools/text/textInput.ts → handleTextKeyDown(event, editor)`. The component becomes a thin adapter, and the extracted function is a normal tool test via `TestEditor`.

When browser or Electron semantics are themselves the behavior, cover that thin adapter with a focused Desktop E2E test instead of recreating the environment with jsdom, global stubs, or IPC mocks. If extraction and a real E2E boundary still do not provide worthwhile automation, pause and ask before introducing new test infrastructure; otherwise record focused manual QA.

## Why these rules exist

The codebase went through a deliberate sweep that deleted thousands of lines of mock-based tests. See commits `5f2f503`, `876e542`, `642ec99`, `bfea0b5`, `3f3a6d6`, `fa8a829`, `bd07e9d`, `3f3a6d6 Delete MockFontEngine`. The motivating pain was real:

- Mocks drifted from the real Rust behavior they pretended to simulate. Tests passed; production broke.
- Spy-count tests locked in implementation details; every refactor broke tests that weren't guarding any behavior.
- Global stubs (`vi.stubGlobal("window", ...)`) leaked across test files and hid unmanaged global dependencies.
- Mock context builders (`services.ts`, 1,795 lines) became their own maintenance burden.

The replacement — real `Editor`, real Rust via NAPI, fake only at the outermost boundary (`SystemClipboard`, `NativeBridge`) — catches regressions mocks silently missed. Don't reintroduce what was deleted.

## Visual E2E reliability

Before adding or changing screenshot assertions, follow [Desktop E2E capture determinism](../../../apps/desktop/e2e/README.md#capture-determinism).

- Control host-dependent capture inputs, including native scrollbar gutters; fixed viewport dimensions alone are insufficient.
- Verify the installed capture API and use identical normalization for golden assertions and review attachments. Preserve behavioral and visibility checks on the unmodified layout.
- Inspect baseline differences, then verify without snapshot updates or retries. Repeat under the environmental condition that caused the failure, not only the environment that already passed.
- Do not use increased tolerance, retries, or replacement baselines as a substitute for explaining a mismatch. Skipped E2E checks do not establish merge readiness.

## Running

```bash
pnpm test                  # full vitest suite, runs against real Rust
pnpm test:watch            # watch mode
pnpm test:e2e:visual       # renderer, interaction, and software-rendered visual behavior
pnpm test:e2e:platform     # native desktop and document lifecycle boundaries
pnpm test:e2e:gpu          # hardware rendering and GPU residency behavior
pnpm typecheck             # tsgo across all packages
pnpm lint:check            # oxlint, includes test anti-pattern rules
```

Run the smallest relevant test command and file/title filter while iterating. For broad fixture changes, run the complete affected E2E project. Record exact commands, passed checks, and host-bound failures separately; never present a skipped or blocked native/GPU check as passing.

The relevant checks must pass before committing. If `no-mock-call-assertions` flags your test, it's caught you reaching for the banned pattern — fix the test, don't disable the rule.
