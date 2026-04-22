import { beforeEach, describe, expect, it } from "vitest";
import { KeyboardRouter } from "./KeyboardRouter";
import { TestEditor } from "@/testing";

type KeyboardEventOptions = Partial<
  Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">
>;

function createKeyboardEvent(options: KeyboardEventOptions = {}): KeyboardEvent {
  const event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "preventDefault"
    | "stopPropagation"
    | "target"
  > = {
    key: options.key ?? "",
    code: options.code ?? "",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: options.target ?? null,
  };

  return event as KeyboardEvent;
}

describe("KeyboardRouter", () => {
  let editor: TestEditor;
  let canvasActive: boolean;
  let router: KeyboardRouter;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    // setActiveTool short-circuits if the target matches the current $activeTool,
    // and $activeTool defaults to "select" without actually activating a tool
    // instance. Force activation directly so primaryTool is populated.
    editor.toolManager.activate("select");
    canvasActive = true;

    router = new KeyboardRouter(() => ({
      canvasActive,
      activeTool: editor.getActiveTool(),
      editor,
      toolManager: editor.toolManager,
    }));
  });

  describe("zoom shortcuts", () => {
    it("zooms in on command/control + equal without shift", () => {
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "=", code: "Equal", metaKey: true });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoom).toBeGreaterThan(zoomBefore);
    });

    it("zooms out on command/control + minus without shift", () => {
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "-", code: "Minus", ctrlKey: true });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.zoom).toBeLessThan(zoomBefore);
    });

    it("does not intercept shift+equal (leaves it for native UI zoom)", () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "+", code: "Equal", metaKey: true, shiftKey: true });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoom).toBe(zoomBefore);
    });

    it("does not intercept shift+minus (leaves it for native UI zoom)", () => {
      canvasActive = false;
      const zoomBefore = editor.zoom;
      const e = createKeyboardEvent({ key: "_", code: "Minus", ctrlKey: true, shiftKey: true });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.zoom).toBe(zoomBefore);
    });
  });

  describe("tool shortcuts", () => {
    it("switches tools from canvas shortcuts for non-text tools", () => {
      const e = createKeyboardEvent({ key: "s" });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(editor.getActiveTool()).toBe("shape");
    });

    it("does not run tool shortcuts outside the canvas context", () => {
      canvasActive = false;
      const e = createKeyboardEvent({ key: "s" });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.getActiveTool()).toBe("select");
    });

    it("does not intercept plain typing while the text tool is active", () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: "s" });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.getActiveTool()).toBe("text");
    });
  });

  describe("clipboard shortcuts", () => {
    beforeEach(() => {
      editor.selectTool("pen");
      editor.click(100, 100);
      editor.click(200, 100);
      editor.click(200, 200);
      editor.click(100, 200);
      editor.selectTool("select");
      editor.selectAll();
    });

    it("runs paste even when canvas is inactive", async () => {
      await editor.copy();
      const pointsBefore = editor.pointCount;
      canvasActive = false;
      const e = createKeyboardEvent({ key: "v", ctrlKey: true });

      const handled = router.handleKeyDown(e);
      // Clipboard paste is async; wait for the microtask to settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(handled).toBe(true);
      expect(editor.pointCount).toBeGreaterThan(pointsBefore);
    });

    it("does not intercept paste while the text tool is active", async () => {
      await editor.copy();
      editor.selectTool("text");
      const pointsBefore = editor.pointCount;
      const e = createKeyboardEvent({ key: "v", metaKey: true });

      router.handleKeyDown(e);
      await Promise.resolve();

      expect(editor.pointCount).toBe(pointsBefore);
    });

    it("does not intercept copy while the text tool is active", async () => {
      editor.selectTool("text");
      const bufferBefore = editor.clipboardBuffer;
      const e = createKeyboardEvent({ key: "c", metaKey: true });

      router.handleKeyDown(e);
      await Promise.resolve();

      expect(editor.clipboardBuffer).toBe(bufferBefore);
    });
  });

  describe("temporary hand tool (space)", () => {
    it("activates the hand tool on space and returns to the previous tool on keyup", () => {
      const down = createKeyboardEvent({ key: " ", code: "Space" });
      const up = createKeyboardEvent({ key: " ", code: "Space" });

      router.handleKeyDown(down);
      // Temporary tools are tracked as toolManager overrides; activeToolId
      // reflects the override while primaryToolId stays on the base tool.
      expect(editor.toolManager.activeToolId).toBe("hand");
      expect(editor.toolManager.primaryToolId).toBe("select");
      expect(editor.previewMode).toBe(true);

      router.handleKeyUp(up);
      expect(editor.toolManager.activeToolId).toBe("select");
      expect(editor.previewMode).toBe(false);
    });

    it("does not activate the hand tool on space while the text tool is active", () => {
      editor.selectTool("text");
      const e = createKeyboardEvent({ key: " ", code: "Space" });

      router.handleKeyDown(e);

      expect(editor.getActiveTool()).toBe("text");
    });
  });

  describe("focus handling", () => {
    it("does not intercept shortcuts while an editable input has focus", () => {
      const input = { tagName: "INPUT" } as EventTarget & { tagName: string };
      const e = createKeyboardEvent({ key: "a", metaKey: true, target: input });

      const handled = router.handleKeyDown(e);

      expect(handled).toBe(false);
      expect(editor.selection.pointIds.size).toBe(0);
    });
  });
});
