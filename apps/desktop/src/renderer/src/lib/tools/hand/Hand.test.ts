import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Hand tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("hand");
  });

  it("drag pans the viewport by the screen delta", () => {
    const startPan = editor.pan;

    editor.pointerDown(0, 0);
    editor.pointerMove(50, 30); // crosses drag threshold, emits dragStart
    editor.pointerMove(120, 80); // cumulative screenDelta = (120, 80)
    editor.pointerUp(120, 80);

    expect(editor.pan.x).toBe(startPan.x + 120);
    expect(editor.pan.y).toBe(startPan.y + 80);
  });

  it("escape mid-drag returns the tool to ready without further panning", () => {
    editor.pointerDown(0, 0);
    editor.pointerMove(50, 0); // start dragging
    editor.pointerMove(100, 0);
    const panMidDrag = editor.pan;

    editor.escape();

    const state = editor.getActiveToolState();
    expect(state.type).toBe("ready");

    // After cancel, further moves without a new pointerDown must not pan.
    editor.pointerMove(200, 0);
    expect(editor.pan).toEqual(panMidDrag);
  });

  it("pointer hover in ready state does not pan", () => {
    const startPan = editor.pan;

    editor.pointerMove(50, 50);
    editor.pointerMove(100, 100);

    expect(editor.pan).toEqual(startPan);
  });
});
