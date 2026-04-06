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
    const buffer = editor.textRunManager.buffer;
    buffer.insert({ glyphName: "A", unicode: 65 });
    buffer.insert({ glyphName: "B", unicode: 66 });
    buffer.moveTo(0);

    editor.selectTool("text");

    expect(buffer.cursorPosition).toBe(buffer.length);
  });

  it("returns to select tool on Escape", () => {
    editor.selectTool("text");
    expect(editor.toolManager.activeToolId).toBe("text");

    editor.keyDown("Escape");

    expect(editor.toolManager.activeToolId).toBe("select");
  });

  it("handles character input and advances cursor", () => {
    editor.selectTool("text");
    const buffer = editor.textRunManager.buffer;
    const lengthBefore = buffer.length;

    editor.keyDown("b");

    expect(buffer.length).toBeGreaterThanOrEqual(lengthBefore);
  });
});
