import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import type { Rect2D } from "@shift/types";

const canvasBounds: Rect2D = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  left: 0,
  top: 0,
  right: 800,
  bottom: 600,
};

describe("EdgePanManager", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("hand");
  });

  it("pans the viewport when the cursor is near the edge during a drag", () => {
    // Start a hand-tool drag so toolManager.isDragging is true.
    editor.pointerDown(400, 300);
    editor.pointerMove(420, 300); // crosses drag threshold, starts dragging
    const panBeforeEdgePan = { ...editor.pan };

    // Cursor near the left edge while still dragging. The viewport should
    // scroll to reveal content to the left, which means pan.x increases.
    editor.updateEdgePan({ x: 10, y: 300 }, canvasBounds);

    expect(editor.pan.x).toBeGreaterThan(panBeforeEdgePan.x);
  });

  it("does not pan when not dragging", () => {
    const startPan = { ...editor.pan };

    editor.updateEdgePan({ x: 10, y: 300 }, canvasBounds);

    expect(editor.pan).toEqual(startPan);
  });
});
