import { describe, it, expect, beforeEach } from "vitest";
import { BaseTool } from "./BaseTool";
import type { ToolEvent } from "./GestureDetector";
import { makeTestCoordinates, TestEditor } from "@/testing";
import type { ToolName } from "./createContext";
import type { Behavior } from "./Behavior";

type ContractState = { type: "idle" } | { type: "ready" } | { type: "clicked" };

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
      const clickEvent: ToolEvent = {
        type: "click",
        point: { x: 10, y: 10 },
        coords: makeTestCoordinates({ x: 10, y: 10 }),
        shiftKey: false,
        altKey: false,
      };

      tool.handleEvent(clickEvent);

      expect(tool.getState()).toEqual({ type: "clicked" });
      expect(editor.getActiveToolState()).toEqual({ type: "clicked" });
      expect(tool.stateChanges).toEqual([
        { prev: { type: "ready" }, next: { type: "clicked" }, event: clickEvent },
      ]);
    });
  });

  describe("when state is unchanged (same reference)", () => {
    it("does not fire onStateChange when no behavior matches", () => {
      const moveEvent: ToolEvent = {
        type: "pointerMove",
        point: { x: 10, y: 10 },
        coords: makeTestCoordinates({ x: 10, y: 10 }),
      };

      tool.handleEvent(moveEvent);

      expect(tool.getState()).toEqual({ type: "ready" });
      expect(tool.stateChanges).toEqual([]);
    });

    it("does not fire onStateChange when transition returns same state after clicked", () => {
      tool.handleEvent({
        type: "click",
        point: { x: 0, y: 0 },
        coords: makeTestCoordinates({ x: 0, y: 0 }),
        shiftKey: false,
        altKey: false,
      });
      tool.stateChanges.length = 0;

      tool.handleEvent({
        type: "pointerMove",
        point: { x: 5, y: 5 },
        coords: makeTestCoordinates({ x: 5, y: 5 }),
      });

      expect(tool.stateChanges).toEqual([]);
    });
  });
});
