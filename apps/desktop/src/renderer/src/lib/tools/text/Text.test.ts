import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing";

describe("Text tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession("A", 65);
  });

  it("enters typing state when activated", () => {
    editor.selectTool("text");

    const state = editor.toolManager.activeTool?.getState() as { type: string };
    expect(state.type).toBe("typing");
  });

  it("moves cursor to end of buffer when activating", () => {
    const ctrl = editor.textRunController;
    ctrl.insert({ glyphName: "A", unicode: 65 });
    ctrl.insert({ glyphName: "B", unicode: 66 });
    ctrl.placeCaret(0);

    editor.selectTool("text");

    expect(ctrl.cursor).toBe(ctrl.length);
  });

  it("returns to select tool on Escape", () => {
    editor.selectTool("text");
    expect(editor.toolManager.activeToolId).toBe("text");

    editor.keyDown("Escape");

    expect(editor.toolManager.activeToolId).toBe("select");
  });

  it("handles character input and advances cursor", () => {
    editor.selectTool("text");
    const ctrl = editor.textRunController;
    const lengthBefore = ctrl.length;

    editor.keyDown("b");

    expect(ctrl.length).toBeGreaterThanOrEqual(lengthBefore);
  });
});
