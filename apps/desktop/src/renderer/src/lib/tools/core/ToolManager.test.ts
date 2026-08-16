import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("tool selection and temporary overrides", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
  });

  it("keeps Pen behavior active while Meta is pressed", () => {
    editor.selectTool("pen");
    const penCursor = editor.cursor;

    editor.keyDown("Meta", { metaKey: true });

    expect(editor.cursor).toBe(penCursor);
    expect(editor.currentModifiers.metaKey).toBe(true);
  });

  it("temporarily pans with Hand and then resumes Pen editing", async () => {
    await editor.startSession();
    editor.selectTool("pen");
    const penCursor = editor.cursor;

    editor.requestTemporaryTool("hand");
    editor.pointerDown(0, 0).pointerMove(50, 30).pointerMove(120, 80).pointerUp(120, 80);
    editor.returnFromTemporaryTool();
    editor.clickGlyphLocal(100, 100);
    await editor.settle();

    expect(editor.pan).toEqual({ x: 120, y: 80 });
    expect(editor.cursor).toBe(penCursor);
    expect(editor.pointCount).toBe(1);
  });

  it("does not replace an active temporary Hand tool", () => {
    editor.selectTool("pen");
    editor.requestTemporaryTool("hand");
    const handCursor = editor.cursor;

    editor.requestTemporaryTool("shape");
    editor.pointerDown(0, 0).pointerMove(50, 0).pointerMove(100, 0).pointerUp(100, 0);

    expect(editor.pan.x).toBe(100);
    expect(editor.cursor).toBe(handCursor);
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
