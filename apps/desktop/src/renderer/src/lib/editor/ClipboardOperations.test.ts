import { beforeEach, describe, expect, it } from "vitest";
import type { ContourId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { OutlineContour } from "@/testing/reads";

describe("editor clipboard operations", () => {
  const editor = useTestEditor();

  beforeEach(async () => {
    editor.selectTool("shape");
    await editor.dragFrom({ x: 20, y: 40 }, { x: 130, y: 150 });
    const [contour] = await editor.outline();
    editor.selectObjects([contour!.id as ContourId]);
  });

  it("pastes copied geometry into another glyph without changing the source", async () => {
    const [source] = await editor.outline();
    await editor.copy();
    await editor.addGlyph("B", 66);
    await editor.openGlyph("B");

    expect(await editor.paste()).toBe(true);

    const [pasted] = await editor.outline();
    expect(contourShape(pasted!)).toEqual(offsetContour(source!, 20, -20));
    expect((await editor.layerOf("A")).contours).toHaveLength(1);

    await editor.undo();
    expect(await editor.outline()).toHaveLength(0);
    expect((await editor.layerOf("A")).contours).toHaveLength(1);
  });
});

function contourShape(contour: OutlineContour) {
  return {
    closed: contour.closed,
    points: contour.points.map(({ x, y, pointType, smooth }) => ({ x, y, pointType, smooth })),
  };
}

function offsetContour(contour: OutlineContour, dx: number, dy: number) {
  const shape = contourShape(contour);

  return {
    ...shape,
    points: shape.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
  };
}
