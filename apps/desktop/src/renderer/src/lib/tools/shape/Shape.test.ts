import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Shape tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("shape");
  });

  it("drag then release commits a closed 4-point rectangle contour", () => {
    const glyph = editor.currentGlyph;
    if (!glyph) return;
    const contoursBefore = glyph.contours.length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30); // crosses drag threshold
    editor.pointerMove(110, 90);
    editor.pointerUp(110, 90);

    const contours = glyph.contours;
    expect(contours.length).toBe(contoursBefore + 1);

    const created = contours[contours.length - 1]!;
    expect(created.points.length).toBe(4);
    expect(created.closed).toBe(true);
  });

  it("escape mid-drag discards the preview without committing a contour", () => {
    const glyph = editor.currentGlyph;
    if (!glyph) return;
    const contoursBefore = glyph.contours.length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30);
    editor.pointerMove(110, 90);
    editor.escape();

    expect(glyph.contours.length).toBe(contoursBefore);
    const state = editor.getActiveToolState();
    expect(state.type).toBe("ready");
  });

  it("drag smaller than the 3-unit minimum does not commit", () => {
    const glyph = editor.currentGlyph;
    if (!glyph) return;
    const contoursBefore = glyph.contours.length;

    editor.pointerDown(10, 10);
    editor.pointerMove(14, 14); // past drag threshold but resulting rect is 4x4 in screen coords
    editor.pointerMove(12, 12); // shrink below minimum width/height
    editor.pointerUp(12, 12);

    expect(glyph.contours.length).toBe(contoursBefore);
  });
});
