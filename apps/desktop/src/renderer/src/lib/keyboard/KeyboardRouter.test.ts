import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardRouter } from "./KeyboardRouter";
import type { KeyboardEditorActions, KeyboardToolManagerActions } from "./types";
import type { ToolName } from "@/lib/tools/core";

function createKeyboardEvent(options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: options.key ?? "",
    code: options.code ?? "",
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: options.target ?? null,
  } as KeyboardEvent;
}

describe("KeyboardRouter", () => {
  let activeTool: ToolName;
  let canvasActive: boolean;
  let editor: KeyboardEditorActions;
  let toolManager: KeyboardToolManagerActions;
  let router: KeyboardRouter;

  beforeEach(() => {
    activeTool = "select";
    canvasActive = true;

    editor = {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      requestRedraw: vi.fn(),
      copy: vi.fn(),
      cut: vi.fn(),
      paste: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      selectAll: vi.fn(),
      deleteSelectedPoints: vi.fn(),
      setActiveTool: vi.fn(),
      getToolShortcuts: vi.fn(() => [
        { toolId: "select", shortcut: "v" },
        { toolId: "pen", shortcut: "p" },
        { toolId: "hand", shortcut: "h" },
        { toolId: "shape", shortcut: "s" },
        { toolId: "text", shortcut: "t" },
      ]),
      requestTemporaryTool: vi.fn((_tool, options) => options?.onActivate?.()),
      returnFromTemporaryTool: vi.fn(),
      isPreviewMode: vi.fn(() => false),
      setPreviewMode: vi.fn(),
      insertTextCodepoint: vi.fn(),
      recomputeTextRun: vi.fn(),
      getTextRunCodepoints: vi.fn(() => []),
    };

    toolManager = {
      handleKeyDown: vi.fn(() => false),
      handleKeyUp: vi.fn(() => false),
    };

    router = new KeyboardRouter(() => ({
      canvasActive,
      activeTool,
      editor,
      toolManager,
    }));
  });

  it("runs global paste shortcut even when canvas is inactive", () => {
    canvasActive = false;
    const e = createKeyboardEvent({ key: "v", ctrlKey: true });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.paste).toHaveBeenCalledTimes(1);
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("applies canvas zoom in for command/control + equal without shift", () => {
    const e = createKeyboardEvent({ key: "=", code: "Equal", metaKey: true, shiftKey: false });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.zoomIn).toHaveBeenCalledTimes(1);
    expect(editor.requestRedraw).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("applies canvas zoom out for command/control + minus without shift", () => {
    const e = createKeyboardEvent({ key: "-", code: "Minus", ctrlKey: true, shiftKey: false });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.zoomOut).toHaveBeenCalledTimes(1);
    expect(editor.requestRedraw).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not intercept command/control + shift + equal (allows native UI zoom)", () => {
    canvasActive = false;
    const e = createKeyboardEvent({ key: "+", code: "Equal", metaKey: true, shiftKey: true });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(false);
    expect(editor.zoomIn).not.toHaveBeenCalled();
    expect(editor.requestRedraw).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("does not intercept command/control + shift + minus (allows native UI zoom)", () => {
    canvasActive = false;
    const e = createKeyboardEvent({ key: "_", code: "Minus", ctrlKey: true, shiftKey: true });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(false);
    expect(editor.zoomOut).not.toHaveBeenCalled();
    expect(editor.requestRedraw).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("does not run tool shortcuts outside canvas context", () => {
    canvasActive = false;
    const e = createKeyboardEvent({ key: "s" });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(false);
    expect(editor.setActiveTool).not.toHaveBeenCalled();
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
  });

  it("switches tools from canvas shortcuts for non-text tools", () => {
    activeTool = "select";
    const e = createKeyboardEvent({ key: "s" });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.setActiveTool).toHaveBeenCalledWith("shape");
    expect(editor.requestRedraw).toHaveBeenCalledTimes(1);
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
  });

  it("captures plain typing in text mode before tool shortcuts", () => {
    activeTool = "text";
    const e = createKeyboardEvent({ key: "s" });
    (toolManager.handleKeyDown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(toolManager.handleKeyDown).toHaveBeenCalledWith(e);
    expect(editor.setActiveTool).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("routes paste to text handler in text mode instead of global paste", () => {
    activeTool = "text";
    const e = createKeyboardEvent({ key: "v", metaKey: true });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.paste).not.toHaveBeenCalled();
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("routes copy to text handler in text mode instead of global copy", () => {
    activeTool = "text";
    const e = createKeyboardEvent({ key: "c", metaKey: true });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.copy).not.toHaveBeenCalled();
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("inserts space in text mode instead of activating temporary hand", () => {
    activeTool = "text";
    const e = createKeyboardEvent({ key: " ", code: "Space" });
    (toolManager.handleKeyDown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(editor.requestTemporaryTool).not.toHaveBeenCalled();
    expect(toolManager.handleKeyDown).toHaveBeenCalledWith(e);
  });

  it("activates temporary hand on space and releases it on keyup", () => {
    activeTool = "select";
    const down = createKeyboardEvent({ key: " ", code: "Space" });
    const up = createKeyboardEvent({ key: " ", code: "Space" });

    const downHandled = router.handleKeyDown(down);
    const upHandled = router.handleKeyUp(up);

    expect(downHandled).toBe(true);
    expect(editor.requestTemporaryTool).toHaveBeenCalledTimes(1);
    expect(editor.setPreviewMode).toHaveBeenCalledWith(true);
    expect(upHandled).toBe(true);
    expect(editor.returnFromTemporaryTool).toHaveBeenCalledTimes(1);
  });

  it("falls back to tool manager when no keymap matches in canvas", () => {
    const e = createKeyboardEvent({ key: "q" });
    (toolManager.handleKeyDown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(true);
    expect(toolManager.handleKeyDown).toHaveBeenCalledWith(e);
  });

  it("does not intercept shortcuts when an editable input has focus", () => {
    const input = { tagName: "INPUT" } as unknown as EventTarget;
    const e = createKeyboardEvent({ key: "a", metaKey: true, target: input });

    const handled = router.handleKeyDown(e);

    expect(handled).toBe(false);
    expect(editor.selectAll).not.toHaveBeenCalled();
    expect(toolManager.handleKeyDown).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
