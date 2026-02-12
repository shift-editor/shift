import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "./ToolManager";
import { createMockToolContext, type MockToolContext } from "@/testing";
import { Hand } from "../hand/Hand";
import { Select } from "../select/Select";
import { Pen } from "../pen/Pen";
import TextTool from "../text/Text";
import type { ToolName } from "./createContext";
import type { Modifiers } from "./GestureDetector";

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
  let editor: MockToolContext & {
    requestTemporaryTool(
      toolId: ToolName,
      options?: { onActivate?: () => void; onReturn?: () => void },
    ): void;
    returnFromTemporaryTool(): void;
  };

  beforeEach(() => {
    const ctx = createMockToolContext();
    editor = ctx as typeof editor;
    toolManager = new ToolManager(editor as any);
    editor.requestTemporaryTool = (toolId, options) =>
      toolManager.requestTemporary(toolId, options);
    editor.returnFromTemporaryTool = () => toolManager.returnFromTemporary();
    toolManager.register("hand", Hand);
    toolManager.register("select", Select);
    toolManager.register("pen", Pen);
    toolManager.register("text", TextTool);
  });

  describe("keyboard delegation", () => {
    it("does not switch tools on space keydown by itself", () => {
      toolManager.activate("pen");
      editor.mocks.render.setPreviewMode.mockClear();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));

      expect(editor.mocks.render.setPreviewMode).not.toHaveBeenCalledWith(true);
      expect(toolManager.activeToolId).toBe("pen");
    });

    it("returns true when active tool handles keydown", () => {
      toolManager.activate("text");
      const handled = toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "a" }));

      expect(handled).toBe(true);
    });
  });

  describe("meta key behavior (zoom support)", () => {
    it("should NOT switch to select tool when meta key is pressed", () => {
      toolManager.activate("pen");
      editor.mocks.cursor.set.mockClear();

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
      const initialCursor = editor.getCursorValue();

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Meta", metaKey: true }));
      toolManager.handleKeyUp(createKeyboardEvent("keyup", { key: "Meta" }));

      expect(editor.getCursorValue()).toBe(initialCursor);
      expect(toolManager.activeToolId).toBe("pen");
    });
  });

  describe("tool activation", () => {
    it("should provide cursor signal when activating tool normally", () => {
      toolManager.activate("pen");

      expect(toolManager.activeTool?.$cursor.value).toEqual({ type: "pen" });
    });

    it("should provide cursor signal when activating temporary hand tool", () => {
      toolManager.activate("pen");

      editor.requestTemporaryTool("hand");

      expect(toolManager.activeTool?.$cursor.value).toEqual({ type: "grab" });
    });
  });

  describe("override tool behavior", () => {
    it("should not activate override if already overridden", () => {
      toolManager.activate("pen");

      editor.requestTemporaryTool("hand");
      expect(toolManager.activeToolId).toBe("hand");

      editor.requestTemporaryTool("hand");
      expect(toolManager.activeToolId).toBe("hand");
    });

    it("should track primary tool separately from active tool", () => {
      toolManager.activate("pen");

      editor.requestTemporaryTool("hand");

      expect(toolManager.primaryToolId).toBe("pen");
      expect(toolManager.activeToolId).toBe("hand");
    });
  });

  describe("ToolSwitchService", () => {
    it("should expose requestTemporary method", () => {
      toolManager.activate("pen");

      editor.requestTemporaryTool("hand");

      expect(toolManager.activeToolId).toBe("hand");
      expect(toolManager.primaryToolId).toBe("pen");
    });

    it("should expose returnFromTemporary method", () => {
      toolManager.activate("pen");
      editor.requestTemporaryTool("hand");

      editor.returnFromTemporaryTool();

      expect(toolManager.activeToolId).toBe("pen");
    });

    it("should call onActivate callback when requesting temporary tool", () => {
      toolManager.activate("pen");
      const onActivate = { fn: () => {} };
      const spy = vi.spyOn(onActivate, "fn");

      editor.requestTemporaryTool("hand", { onActivate: onActivate.fn });

      expect(spy).toHaveBeenCalled();
    });

    it("should call onReturn callback when returning from temporary tool", () => {
      toolManager.activate("pen");
      const onReturn = { fn: () => {} };
      const spy = vi.spyOn(onReturn, "fn");

      editor.requestTemporaryTool("hand", { onReturn: onReturn.fn });
      editor.returnFromTemporaryTool();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("pipeline (pointer → gesture → tool)", () => {
    const modifiers = { shiftKey: false, altKey: false };

    it("tap (down then up at same point) drives tool with click and leaves activeToolState defined", () => {
      toolManager.activate("select");

      toolManager.handlePointerDown({ x: 100, y: 100 }, modifiers);
      toolManager.handlePointerUp({ x: 100, y: 100 });

      expect(toolManager.activeToolId).toBe("select");
      const lastState = (editor.activeToolState as { value: unknown }).value;
      expect(lastState).toBeDefined();
      expect(typeof (lastState as { type?: string })?.type).toBe("string");
    });

    it("drag (down, move, up) drives tool with dragStart, drag, dragEnd and does not emit click", () => {
      const originalRAF = globalThis.requestAnimationFrame;
      vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
        cb();
        return 0;
      });
      try {
        toolManager.activate("hand");
        toolManager.handlePointerDown({ x: 100, y: 100 }, modifiers);
        toolManager.handlePointerMove({ x: 120, y: 100 }, modifiers);
        toolManager.handlePointerUp({ x: 120, y: 100 });

        expect(toolManager.isDragging).toBe(false);
        const lastState = (editor.activeToolState as { value: unknown }).value as {
          type?: string;
        };
        expect(lastState?.type).toBe("ready");
      } finally {
        vi.stubGlobal("requestAnimationFrame", originalRAF);
      }
    });

    it("deduplicates pointer move when screen point unchanged (no force)", () => {
      const originalRAF = globalThis.requestAnimationFrame;
      vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
        cb();
        return 0;
      });
      try {
        toolManager.activate("select");
        const handleEventSpy = vi.spyOn(toolManager.activeTool!, "handleEvent");

        toolManager.handlePointerMove({ x: 100, y: 100 }, modifiers);
        toolManager.handlePointerMove({ x: 100, y: 100 }, modifiers);

        const pointerMoveCalls = handleEventSpy.mock.calls.filter(
          (c) => c[0] && (c[0] as { type?: string }).type === "pointerMove",
        );
        expect(pointerMoveCalls).toHaveLength(1);
      } finally {
        vi.stubGlobal("requestAnimationFrame", originalRAF);
      }
    });

    it("processes pointer move when screen point unchanged if force: true (e.g. wheel pan)", () => {
      const originalRAF = globalThis.requestAnimationFrame;
      vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
        cb();
        return 0;
      });
      try {
        toolManager.activate("select");
        const handleEventSpy = vi.spyOn(toolManager.activeTool!, "handleEvent");

        toolManager.handlePointerMove({ x: 100, y: 100 }, modifiers);
        toolManager.handlePointerMove({ x: 100, y: 100 }, modifiers, { force: true });

        const pointerMoveCalls = handleEventSpy.mock.calls.filter(
          (c) => c[0] && (c[0] as { type?: string }).type === "pointerMove",
        );
        expect(pointerMoveCalls).toHaveLength(2);
      } finally {
        vi.stubGlobal("requestAnimationFrame", originalRAF);
      }
    });
  });

  describe("currentModifiers", () => {
    it("updates currentModifiers on handlePointerDown", () => {
      toolManager.activate("select");
      const mods: Modifiers = { shiftKey: true, altKey: true, metaKey: true };

      toolManager.handlePointerDown({ x: 0, y: 0 }, mods);

      expect(editor.getCurrentModifiers()).toEqual(mods);
    });

    it("updates currentModifiers on flushPointerMove", () => {
      const originalRAF = globalThis.requestAnimationFrame;
      vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
        cb();
        return 0;
      });
      try {
        toolManager.activate("select");
        const mods: Modifiers = { shiftKey: true, altKey: true };

        toolManager.handlePointerMove({ x: 10, y: 10 }, mods);

        expect(editor.getCurrentModifiers()).toEqual(mods);
      } finally {
        vi.stubGlobal("requestAnimationFrame", originalRAF);
      }
    });

    it("updates currentModifiers on handleKeyDown", () => {
      toolManager.activate("select");

      toolManager.handleKeyDown(
        createKeyboardEvent("keydown", { key: "Alt", altKey: true, shiftKey: false }),
      );

      expect(editor.getCurrentModifiers()).toEqual({
        shiftKey: false,
        altKey: true,
        metaKey: false,
      });
    });

    it("updates currentModifiers on handleKeyUp", () => {
      toolManager.activate("select");
      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Alt", altKey: true }));

      toolManager.handleKeyUp(createKeyboardEvent("keyup", { key: "Alt", altKey: false }));

      expect(editor.getCurrentModifiers()).toEqual({
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
    });
  });
});
