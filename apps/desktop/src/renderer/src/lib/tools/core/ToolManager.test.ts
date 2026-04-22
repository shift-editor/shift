import { describe, it, expect, beforeEach } from "vitest";
import { ToolManager } from "./ToolManager";
import { TestEditor } from "@/testing";
import type { Modifiers } from "./GestureDetector";

type KeyboardEventOptions = Partial<
  Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
>;

function createKeyboardEvent(type: string, options: KeyboardEventOptions = {}): KeyboardEvent {
  const event: Pick<
    KeyboardEvent,
    | "type"
    | "code"
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "preventDefault"
    | "stopPropagation"
  > = {
    type,
    code: options.code ?? "",
    key: options.key ?? "",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {},
  };

  return event as KeyboardEvent;
}

describe("ToolManager", () => {
  let toolManager: ToolManager;
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    toolManager = editor.toolManager;
  });

  describe("keyboard delegation", () => {
    it("does not switch tools on space keydown by itself", () => {
      toolManager.activate("pen");

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { code: "Space" }));

      expect(toolManager.activeToolId).toBe("pen");
    });

    it("returns true when active tool handles keydown", () => {
      toolManager.activate("text");
      const handled = toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Escape" }));

      expect(handled).toBe(true);
    });
  });

  describe("meta key behavior (zoom support)", () => {
    it("should NOT switch to select tool when meta key is pressed", () => {
      toolManager.activate("pen");

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
      const initialCursor = editor.cursor;

      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Meta", metaKey: true }));
      toolManager.handleKeyUp(createKeyboardEvent("keyup", { key: "Meta" }));

      expect(editor.cursor).toBe(initialCursor);
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

    it("runs the onActivate callback when requesting a temporary tool", () => {
      toolManager.activate("pen");
      let activated = false;

      editor.requestTemporaryTool("hand", { onActivate: () => (activated = true) });

      expect(activated).toBe(true);
    });

    it("runs the onReturn callback when returning from a temporary tool", () => {
      toolManager.activate("pen");
      let returned = false;

      editor.requestTemporaryTool("hand", { onReturn: () => (returned = true) });
      editor.returnFromTemporaryTool();

      expect(returned).toBe(true);
    });
  });

  describe("pipeline (pointer -> gesture -> tool)", () => {
    const modifiers = { shiftKey: false, altKey: false, metaKey: false };

    it("tap (down then up at same point) drives tool with click and leaves activeToolState defined", () => {
      toolManager.activate("select");

      toolManager.handlePointerDown({ x: 100, y: 100 }, modifiers);
      toolManager.handlePointerUp({ x: 100, y: 100 });

      expect(toolManager.activeToolId).toBe("select");
      const lastState = editor.getActiveToolState();
      expect(lastState).toBeDefined();
      expect(typeof (lastState as { type?: string })?.type).toBe("string");
    });

    it("drag (down, move, up) drives tool with dragStart, drag, dragEnd and does not emit click", () => {
      toolManager.activate("hand");
      toolManager.handlePointerDown({ x: 100, y: 100 }, modifiers);
      toolManager.handlePointerMove({ x: 120, y: 100 }, modifiers);
      toolManager.flushPointerMoves();
      toolManager.handlePointerUp({ x: 120, y: 100 });

      expect(toolManager.isDragging).toBe(false);
      const lastState = editor.getActiveToolState() as { type?: string };
      expect(lastState?.type).toBe("ready");
    });
  });

  describe("currentModifiers", () => {
    it("updates currentModifiers on handlePointerDown", () => {
      toolManager.activate("select");
      const mods: Modifiers = { shiftKey: true, altKey: true, metaKey: true };

      toolManager.handlePointerDown({ x: 0, y: 0 }, mods);

      expect(editor.currentModifiers).toEqual(mods);
    });

    it("updates currentModifiers on flushPointerMove", () => {
      toolManager.activate("select");
      const mods: Modifiers = { shiftKey: true, altKey: true, metaKey: false };

      toolManager.handlePointerMove({ x: 10, y: 10 }, mods);
      toolManager.flushPointerMoves();

      expect(editor.currentModifiers).toEqual(mods);
    });

    it("updates currentModifiers on handleKeyDown", () => {
      toolManager.activate("select");

      toolManager.handleKeyDown(
        createKeyboardEvent("keydown", { key: "Alt", altKey: true, shiftKey: false }),
      );

      expect(editor.currentModifiers).toEqual({
        shiftKey: false,
        altKey: true,
        metaKey: false,
      });
    });

    it("updates currentModifiers on handleKeyUp", () => {
      toolManager.activate("select");
      toolManager.handleKeyDown(createKeyboardEvent("keydown", { key: "Alt", altKey: true }));

      toolManager.handleKeyUp(createKeyboardEvent("keyup", { key: "Alt", altKey: false }));

      expect(editor.currentModifiers).toEqual({
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
    });
  });
});
