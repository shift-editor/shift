import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "./ToolManager";
import { createMockToolContext, type MockToolContext } from "@/testing";
import { Hand } from "../hand/Hand";
import { Select } from "../select/Select";
import { Pen } from "../pen/Pen";

function createKeyboardEvent(type: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type,
    code: options.code ?? "",
    key: options.key ?? "",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as KeyboardEvent;
}

describe("ToolManager", () => {
  let toolManager: ToolManager;
  let ctx: MockToolContext;

  beforeEach(() => {
    ctx = createMockToolContext();
    toolManager = new ToolManager(ctx);
    toolManager.register("hand", Hand);
    toolManager.register("select", Select);
    toolManager.register("pen", Pen);
  });

  describe("space key for hand tool", () => {
    it("should enable preview mode when space is pressed via tool handleModifier", () => {
      toolManager.activate("pen");
      ctx.mocks.render.mocks.setPreviewMode.mockClear();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));

      expect(ctx.mocks.render.mocks.setPreviewMode).toHaveBeenCalledWith(true);
      expect(toolManager.activeToolId).toBe("hand");
    });

    it("should disable preview mode when space is released", () => {
      toolManager.activate("pen");
      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));
      ctx.mocks.render.mocks.setPreviewMode.mockClear();

      toolManager.handleKeyUp(createKeyboardEvent("keyup", { code: "Space" }));

      expect(ctx.mocks.render.mocks.setPreviewMode).toHaveBeenCalledWith(false);
      expect(toolManager.activeToolId).toBe("pen");
    });

    it("should return to primary tool after space is released", () => {
      toolManager.activate("select");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));
      expect(toolManager.activeToolId).toBe("hand");

      toolManager.handleKeyUp(createKeyboardEvent("keyup", { code: "Space" }));
      expect(toolManager.activeToolId).toBe("select");
    });
  });

  describe("meta key behavior (zoom support)", () => {
    it("should NOT switch to select tool when meta key is pressed", () => {
      toolManager.activate("pen");
      ctx.mocks.cursor.mocks.set.mockClear();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Meta", metaKey: true }));

      expect(toolManager.activeToolId).toBe("pen");
    });

    it("should keep current tool while holding meta for zoom", () => {
      toolManager.activate("pen");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Meta", metaKey: true }));

      expect(toolManager.activeToolId).toBe("pen");
      expect(toolManager.primaryToolId).toBe("pen");
    });

    it("should not interfere with zoom operations", () => {
      toolManager.activate("pen");
      const initialCursor = ctx.getCursor();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Meta", metaKey: true }));
      toolManager.handleKeyUp(createKeyboardEvent("keyup", { key: "Meta" }));

      expect(ctx.getCursor()).toBe(initialCursor);
      expect(toolManager.activeToolId).toBe("pen");
    });
  });

  describe("tool activation", () => {
    it("should update cursor when activating tool normally", () => {
      ctx.mocks.cursor.mocks.set.mockClear();

      toolManager.activate("pen");

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });

    it("should update cursor when activating hand tool via space", () => {
      toolManager.activate("pen");
      ctx.mocks.cursor.mocks.set.mockClear();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "grab" });
    });
  });

  describe("override tool behavior", () => {
    it("should not activate override if already overridden", () => {
      toolManager.activate("pen");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));
      expect(toolManager.activeToolId).toBe("hand");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));
      expect(toolManager.activeToolId).toBe("hand");
    });

    it("should track primary tool separately from active tool", () => {
      toolManager.activate("pen");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));

      expect(toolManager.primaryToolId).toBe("pen");
      expect(toolManager.activeToolId).toBe("hand");
    });
  });

  describe("ToolSwitchService", () => {
    it("should expose requestTemporary method", () => {
      toolManager.activate("pen");

      ctx.tools.requestTemporary("hand");

      expect(toolManager.activeToolId).toBe("hand");
      expect(toolManager.primaryToolId).toBe("pen");
    });

    it("should expose returnFromTemporary method", () => {
      toolManager.activate("pen");
      ctx.tools.requestTemporary("hand");

      ctx.tools.returnFromTemporary();

      expect(toolManager.activeToolId).toBe("pen");
    });

    it("should call onActivate callback when requesting temporary tool", () => {
      toolManager.activate("pen");
      const onActivate = { fn: () => {} };
      const spy = vi.spyOn(onActivate, "fn");

      ctx.tools.requestTemporary("hand", { onActivate: onActivate.fn });

      expect(spy).toHaveBeenCalled();
    });

    it("should call onReturn callback when returning from temporary tool", () => {
      toolManager.activate("pen");
      const onReturn = { fn: () => {} };
      const spy = vi.spyOn(onReturn, "fn");

      ctx.tools.requestTemporary("hand", { onReturn: onReturn.fn });
      ctx.tools.returnFromTemporary();

      expect(spy).toHaveBeenCalled();
    });
  });
});
