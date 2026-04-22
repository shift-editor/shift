---
name: writing-tests
description: Canonical rules for writing tests in the Shift codebase. Use whenever you add, rewrite, or review a `.test.ts` file — or any time you're about to mock, stub, or spy your way around a testing problem. This repo has deliberately swept mock-based testing out, and this skill is what keeps it out.
---

# /writing-tests — How tests are written in this codebase

The goal is tests that survive a full rewrite of the implementation, as long as the behavior stays the same. If your test breaks when a private method is renamed or a call count changes, you're testing the wrong thing.

## The rule

**Assert on observable state, not on mock calls.**

Drive the code through its user-facing surface (`editor.copy()`, `editor.click()`, `toolManager.handleKeyDown(...)`) and assert on what a user would see — glyph contours, selection, viewport pan, tool state, command history, returned values. Never on "was method X called N times."

Everything else here is a consequence of that rule.

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

If your target doesn't fit one of these, stop and ask — don't invent a new shape.

### Decision: which one

1. Can a user trigger it with a click, drag, or key? → **Tool test** via `TestEditor`.
2. Is it a single command's undo/redo contract? → **Command test**.
3. Is it a pure function or pure class with no `Editor`? → **Pure module test**.
4. Is it the NAPI boundary? → **Bridge test**.

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

## The fake-test checklist

Before committing a test, run through these. Any miss means the test is wrong.

1. **Mental deletion.** Replace the method body under test with `throw new Error("unimplemented")`. Does your test fail? If it still passes, you wrote a tautology — usually because you asserted on a value you constructed rather than on a consequence.
2. **User-facing surface.** You drove through a method a real user can trigger (pointer, keyboard, command, menu action), not a `#private` field or a tool-internal method.
3. **Specific assertions.** `expect(editor.pointCount).toBe(4)` — yes. `expect(result).toBeDefined()` or `expect(spy).toHaveBeenCalled()` — no, those survive any implementation.
4. **Correct code path.** If the real production path goes through command history + bridge + signals, your test goes through those too. You didn't reach behind the facade.
5. **Under ~15 lines.** If a single `it()` body exceeds ~15 lines, it's testing too much at once, or its setup belongs in `beforeEach`.

## Setup discipline

- `beforeEach` is ≤ 5 lines: `new TestEditor()` + `startSession()` + `selectTool()` + optional fixture.
- No wrapper factories around `TestEditor`. If you need a reusable helper, it belongs as a method on `TestEditor` itself (see `pointerMove`, `click`, `escape`).
- If your test needs a pre-drawn shape, draw it with the pen/shape tool in `beforeEach` — don't construct glyph snapshots inline.

## When testing is genuinely hard

Some code resists clean unit testing — DOM event handlers, focus management, IME composition, React effect lifecycle.

**Default move: extract the non-DOM logic into a pure function and test that.** Example: `HiddenTextInput` keyboard handling → `lib/tools/text/textInput.ts → handleTextKeyDown(event, editor)`. The component becomes a thin adapter; the extracted function is a normal tool test via `TestEditor`. The part that genuinely can't be tested cleanly shrinks to ~20 lines that rely on manual QA.

If after extraction and research you're still reaching for jsdom + `@testing-library/react` + IPC mocks, pause and ask the user before introducing that infrastructure.

## Why these rules exist

The codebase went through a deliberate sweep that deleted thousands of lines of mock-based tests. See commits `5f2f503`, `876e542`, `642ec99`, `bfea0b5`, `3f3a6d6`, `fa8a829`, `bd07e9d`, `3f3a6d6 Delete MockFontEngine`. The motivating pain was real:

- Mocks drifted from the real Rust behavior they pretended to simulate. Tests passed; production broke.
- Spy-count tests locked in implementation details; every refactor broke tests that weren't guarding any behavior.
- Global stubs (`vi.stubGlobal("window", ...)`) leaked across test files and hid unmanaged global dependencies.
- Mock context builders (`services.ts`, 1,795 lines) became their own maintenance burden.

The replacement — real `Editor`, real Rust via NAPI, fake only at the outermost boundary (`SystemClipboard`, `NativeBridge`) — catches regressions mocks silently missed. Don't reintroduce what was deleted.

## Running

```bash
pnpm test              # full vitest suite, runs against real Rust
pnpm test:watch        # watch mode
pnpm typecheck         # tsgo across all packages
pnpm lint:check        # oxlint, includes no-raw-editor-in-tests and no-mock-call-assertions
```

All three must pass before committing. If `no-mock-call-assertions` flags your test, it's caught you reaching for the banned pattern — fix the test, don't disable the rule.
