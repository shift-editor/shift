import type { Contour } from "@shift/glyph-state";
import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("editor clipboard operations", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    await editor.dragLocal({
      down: { x: 20, y: 40 },
      start: { x: 30, y: 50 },
      end: { x: 130, y: 150 },
    });
    editor.selection.select([editor.requireGlyphLayer().contours[0]!.id]);
  });

  it("pastes copied geometry into another glyph without changing the source", async () => {
    const sourceLayer = editor.requireGlyphLayer();
    const source = sourceLayer.contours[0]!;
    await editor.copy();
    await editor.addGlyph("B", 66);

    const destinationRecord = editor.font.recordForName("B");
    const node = editor.glyphNode;
    if (!destinationRecord || !node) throw new Error("Expected destination glyph");
    editor.scene.updateNode({ id: node.id, glyphId: destinationRecord.id });

    expect(await editor.paste()).toBe(true);

    const destinationLayer = editor.requireGlyphLayer();
    expect(contourShape(destinationLayer.contours[0]!)).toEqual(offsetContour(source, 20, -20));
    expect(sourceLayer.contours).toHaveLength(1);

    await editor.undo();
    expect(destinationLayer.contours).toHaveLength(0);
    expect(sourceLayer.contours).toHaveLength(1);
  });
});

function contourShape(contour: Contour) {
  return {
    closed: contour.closed,
    points: contour.points.map(({ x, y, pointType, smooth }) => ({ x, y, pointType, smooth })),
  };
}

function offsetContour(contour: Contour, dx: number, dy: number) {
  const shape = contourShape(contour);

  return {
    ...shape,
    points: shape.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
  };
}
