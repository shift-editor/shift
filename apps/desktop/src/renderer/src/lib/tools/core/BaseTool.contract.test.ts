import { describe, it, expect, beforeEach, vi } from "vitest";
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

class ContractTestTool extends BaseTool<ContractState> {
  readonly id: ToolName = "select";
  readonly behaviors: Behavior<ContractState>[] = [ClickBehavior];
  onStateChangeSpy = vi.fn();

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
    this.onStateChangeSpy(prev, next, event);
  }
}

describe("BaseTool contract", () => {
  let tool: ContractTestTool;
  let editor: TestEditor;
  let setActiveToolStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    editor = new TestEditor();
    setActiveToolStateSpy = vi.spyOn(editor, "setActiveToolState");
    tool = new ContractTestTool(editor);
    tool.activate();
    setActiveToolStateSpy.mockClear();
    tool.onStateChangeSpy.mockClear();
  });

  describe("lifecycle when state changes", () => {
    it("calls setActiveToolState with next state and onStateChange with prev, next, event", () => {
      const clickEvent: ToolEvent = {
        type: "click",
        point: { x: 10, y: 10 },
        coords: makeTestCoordinates({ x: 10, y: 10 }),
        shiftKey: false,
        altKey: false,
      };

      tool.handleEvent(clickEvent);

      expect(setActiveToolStateSpy).toHaveBeenCalledTimes(1);
      expect(setActiveToolStateSpy).toHaveBeenCalledWith({ type: "clicked" });
      expect(tool.onStateChangeSpy).toHaveBeenCalledTimes(1);
      expect(tool.onStateChangeSpy).toHaveBeenCalledWith(
        { type: "ready" },
        { type: "clicked" },
        clickEvent,
      );
      expect(tool.getState()).toEqual({ type: "clicked" });
    });
  });

  describe("lifecycle when state is unchanged (same reference)", () => {
    it("does not call onStateChange when no behavior matches", () => {
      const moveEvent: ToolEvent = {
        type: "pointerMove",
        point: { x: 10, y: 10 },
        coords: makeTestCoordinates({ x: 10, y: 10 }),
      };

      tool.handleEvent(moveEvent);

      expect(setActiveToolStateSpy).not.toHaveBeenCalled();
      expect(tool.onStateChangeSpy).not.toHaveBeenCalled();
      expect(tool.getState()).toEqual({ type: "ready" });
    });

    it("does not call onStateChange when transition returns same state after clicked", () => {
      tool.handleEvent({
        type: "click",
        point: { x: 0, y: 0 },
        coords: makeTestCoordinates({ x: 0, y: 0 }),
        shiftKey: false,
        altKey: false,
      });
      setActiveToolStateSpy.mockClear();
      tool.onStateChangeSpy.mockClear();

      tool.handleEvent({
        type: "pointerMove",
        point: { x: 5, y: 5 },
        coords: makeTestCoordinates({ x: 5, y: 5 }),
      });

      expect(setActiveToolStateSpy).not.toHaveBeenCalled();
      expect(tool.onStateChangeSpy).not.toHaveBeenCalled();
    });
  });
});
