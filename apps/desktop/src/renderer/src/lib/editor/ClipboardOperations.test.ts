import type { Contour } from "@shift/glyph-state";
import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("editor clipboard operations", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    await editor.dragScene({
      down: { x: 20, y: 40 },
      start: { x: 30, y: 50 },
      end: { x: 130, y: 150 },
    });
    editor.selection.select([editor.requireGlyphLayer().contours[0]!.id]);
  });

  it("copies and pastes a closed contour with new selected identities", async () => {
    const layer = editor.requireGlyphLayer();
    const source = layer.contours[0]!;

    expect(await editor.copy()).toBe(true);
    expect(await editor.paste()).toBe(true);

    const pasted = layer.contours[1]!;
    expect(contourShape(pasted)).toEqual(offsetContour(source, 20, -20));
    expect(pasted.points.map(({ id }) => id)).not.toEqual(source.points.map(({ id }) => id));
    expect(editor.selection.ids).toEqual(pasted.points.map(({ id }) => id));
  });

  it("compounds repeated paste offsets and undoes each insertion separately", async () => {
    const layer = editor.requireGlyphLayer();
    const source = layer.contours[0]!;
    await editor.copy();

    await editor.paste();
    await editor.paste();

    expect(contourShape(layer.contours[1]!)).toEqual(offsetContour(source, 20, -20));
    expect(contourShape(layer.contours[2]!)).toEqual(offsetContour(source, 40, -40));

    await editor.undo();
    expect(layer.contours).toHaveLength(2);
    await editor.redo();
    expect(contourShape(layer.contours[2]!)).toEqual(offsetContour(source, 40, -40));
  });

  it("cuts and pastes with separate undoable workspace edits", async () => {
    const layer = editor.requireGlyphLayer();
    const source = layer.contours[0]!;
    const original = contourShape(source);
    const pasted = offsetContour(source, 20, -20);

    expect(await editor.cut()).toBe(true);
    expect(layer.contours).toHaveLength(0);
    expect(editor.selection.hasSelection()).toBe(false);

    expect(await editor.paste()).toBe(true);
    expect(contourShape(layer.contours[0]!)).toEqual(pasted);

    await editor.undo();
    expect(layer.contours).toHaveLength(0);
    await editor.undo();
    expect(layer.contours[0]?.id).toBe(source.id);
    expect(contourShape(layer.contours[0]!)).toEqual(original);

    await editor.redo();
    expect(layer.contours).toHaveLength(0);
    await editor.redo();
    expect(contourShape(layer.contours[0]!)).toEqual(pasted);
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
