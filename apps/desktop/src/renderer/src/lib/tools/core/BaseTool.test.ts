import { describe, it, expect, beforeEach } from "vitest";
import { BaseTool } from "./BaseTool";
import type { ToolEvent } from "./GestureDetector";
import { makeTestCoordinates, TestEditor } from "@/testing";
import type { ToolName } from "./createContext";
import type { Behavior } from "./Behavior";
import { signal, type Signal } from "@/lib/signals";
import type { CursorType } from "@/types/editor";

type ContractState = { type: "idle" } | { type: "ready" } | { type: "clicked" };

const NO_MODIFIERS = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  accelKey: false,
};

const ClickBehavior: Behavior<ContractState> = {
  onClick(state, ctx) {
    if (state.type !== "ready") return false;
    ctx.setState({ type: "clicked" });
    return true;
  },
};

/**
 * Captures every (prev, next, event) triple passed to onStateChange so
 * tests can assert on the full lifecycle payload — what the BaseTool
 * contract promises to downstream tool implementations.
 */
class DisposableTestTool extends BaseTool<ContractState> {
  readonly id: ToolName = "disposable-test";
  readonly behaviors: Behavior<ContractState>[] = [];
  readonly #cursorSourceCell: Signal<CursorType>;

  constructor(editor: TestEditor, cursorSourceCell: Signal<CursorType>) {
    super(editor);
    this.#cursorSourceCell = cursorSourceCell;
  }

  override getCursor(): CursorType {
    return this.#cursorSourceCell.value;
  }

  initialState(): ContractState {
    return { type: "idle" };
  }
}

class ContractTestTool extends BaseTool<ContractState> {
  readonly id: ToolName = "select";
  readonly behaviors: Behavior<ContractState>[] = [ClickBehavior];
  readonly stateChanges: Array<{
    prev: ContractState;
    next: ContractState;
    event: ToolEvent;
  }> = [];

  initialState(): ContractState {
    return { type: "idle" };
  }

  override activate(): void {
    this.state = { type: "ready" };
  }

  protected override onStateChange(
    prev: ContractState,
    next: ContractState,
    event: ToolEvent,
  ): void {
    this.stateChanges.push({ prev, next, event });
  }
}

describe("BaseTool contract", () => {
  let tool: ContractTestTool;
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    tool = new ContractTestTool(editor);
    tool.activate();
    tool.stateChanges.length = 0;
  });

  describe("when state changes", () => {
    it("advances tool state and fires onStateChange with prev/next/event", () => {
      const coords = makeTestCoordinates({ x: 10, y: 10 });
      const clickEvent: ToolEvent = {
        type: "click",
        coords,
        target: { kind: "canvas", point: coords.scene },
        ...NO_MODIFIERS,
      };

      tool.handleEvent(clickEvent);

      expect(tool.getState()).toEqual({ type: "clicked" });
      expect(tool.stateChanges).toEqual([
        { prev: { type: "ready" }, next: { type: "clicked" }, event: clickEvent },
      ]);
    });
  });

  it("permanent disposal severs computed dependencies", () => {
    const cursorSourceCell = signal<CursorType>({ type: "default" });
    const disposableTool = new DisposableTestTool(editor, cursorSourceCell);
    expect(disposableTool.cursorCell.value).toEqual({ type: "default" });

    disposableTool.dispose();
    cursorSourceCell.set({ type: "text" });

    expect(disposableTool.cursorCell.value).toEqual({ type: "default" });
  });

  describe("when state is unchanged (same reference)", () => {
    it("does not fire onStateChange when no behavior matches", () => {
      const coords = makeTestCoordinates({ x: 10, y: 10 });
      const moveEvent: ToolEvent = {
        type: "pointerMove",
        coords,
        target: { kind: "canvas", point: coords.scene },
        ...NO_MODIFIERS,
      };

      tool.handleEvent(moveEvent);

      expect(tool.getState()).toEqual({ type: "ready" });
      expect(tool.stateChanges).toEqual([]);
    });

    it("does not fire onStateChange when transition returns same state after clicked", () => {
      const clickCoords = makeTestCoordinates({ x: 0, y: 0 });
      tool.handleEvent({
        type: "click",
        coords: clickCoords,
        target: { kind: "canvas", point: clickCoords.scene },
        ...NO_MODIFIERS,
      });
      tool.stateChanges.length = 0;

      const moveCoords = makeTestCoordinates({ x: 5, y: 5 });
      tool.handleEvent({
        type: "pointerMove",
        coords: moveCoords,
        target: { kind: "canvas", point: moveCoords.scene },
        ...NO_MODIFIERS,
      });

      expect(tool.stateChanges).toEqual([]);
    });
  });
});
