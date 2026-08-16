import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("tool selection and temporary overrides", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
  });

  it("publishes the selected primary tool, state, and cursor", () => {
    editor.selectTool("pen");

    expect(editor.toolManager.primaryToolId).toBe("pen");
    expect(editor.toolManager.activeToolId).toBe("pen");
    expect(editor.getActiveToolState()).toEqual({ type: "ready" });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "pen" });
  });

  it("keeps the primary tool active when Meta is pressed", () => {
    editor.selectTool("pen");

    editor.keyDown("Meta", { metaKey: true });

    expect(editor.toolManager.primaryToolId).toBe("pen");
    expect(editor.toolManager.activeToolId).toBe("pen");
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "pen" });
  });

  it("temporarily activates Hand and restores the primary tool", () => {
    editor.selectTool("pen");

    editor.requestTemporaryTool("hand");

    expect(editor.toolManager.primaryToolId).toBe("pen");
    expect(editor.toolManager.activeToolId).toBe("hand");
    expect(editor.getActiveToolState()).toEqual({ type: "ready" });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "grab" });

    editor.returnFromTemporaryTool();

    expect(editor.toolManager.activeToolId).toBe("pen");
    expect(editor.getActiveToolState()).toEqual({ type: "ready" });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "pen" });
  });

  it("does not replace an active temporary tool", () => {
    editor.selectTool("pen");
    editor.requestTemporaryTool("hand");

    editor.requestTemporaryTool("shape");

    expect(editor.toolManager.primaryToolId).toBe("pen");
    expect(editor.toolManager.activeToolId).toBe("hand");
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "grab" });
  });

  it("notifies the temporary-tool lifecycle boundary", () => {
    let activated = false;
    let returned = false;
    editor.selectTool("pen");

    editor.requestTemporaryTool("hand", {
      onActivate: () => (activated = true),
      onReturn: () => (returned = true),
    });
    editor.returnFromTemporaryTool();

    expect(activated).toBe(true);
    expect(returned).toBe(true);
  });

  it("publishes the latest pointer modifiers", () => {
    editor.pointerDown(0, 0, { shiftKey: true, altKey: true, metaKey: true });

    expect(editor.currentModifiers).toEqual({
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });

    editor.pointerMove(10, 10, { shiftKey: false, altKey: false, metaKey: false });

    expect(editor.currentModifiers).toEqual({
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  });
});
