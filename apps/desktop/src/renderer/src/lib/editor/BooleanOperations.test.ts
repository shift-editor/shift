import { Polygon } from "@shift/geo";
import { isContourId } from "@shift/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";

const operationCases = [
  {
    operation: "union",
    contourCount: 1,
    area: 14_600,
    bounds: [10, 10, 150, 150],
  },
  {
    operation: "subtract",
    contourCount: 1,
    area: 6_500,
    bounds: [10, 10, 100, 100],
  },
  {
    operation: "intersect",
    contourCount: 1,
    area: 1_600,
    bounds: [60, 60, 100, 100],
  },
  {
    operation: "difference",
    contourCount: 2,
    area: 13_000,
    bounds: [10, 10, 150, 150],
  },
] as const;

describe("editor boolean operations", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 20, y: 20 },
      end: { x: 100, y: 100 },
    });
    editor.selectTool("shape");
    await editor.dragScene({
      down: { x: 60, y: 60 },
      start: { x: 70, y: 70 },
      end: { x: 150, y: 150 },
    });
    editor.selection.select(editor.requireGlyphLayer().contours.map(({ id }) => id));
  });

  it.each(operationCases)(
    "$operation replaces overlapping contours through one undoable workspace edit",
    async ({ operation, contourCount, area, bounds }) => {
      const [contourIdA, contourIdB] = selectedContours(editor);

      await editor.boolean(contourIdA, contourIdB, operation);
      const layer = editor.requireGlyphLayer();
      expectGeometry(layer, contourCount, area, bounds);
      expect(editor.selection.ids).toEqual(layer.contours.map((contour) => contour.id));

      await editor.undo();
      expectGeometry(editor.requireGlyphLayer(), 2, 16_200, [10, 10, 150, 150]);

      await editor.redo();
      expectGeometry(editor.requireGlyphLayer(), contourCount, area, bounds);
    },
  );

  it("clears selection when an operation has no resulting contours", async () => {
    const layer = editor.requireGlyphLayer();
    const secondContour = layer.contours[1];
    if (!secondContour) throw new Error("Expected a second contour");

    layer.applyPositionPatch(
      secondContour.points.map((point) => ({
        kind: "point",
        id: point.id,
        x: point.x + 200,
        y: point.y,
      })),
    );
    await editor.settle();

    const [contourIdA, contourIdB] = selectedContours(editor);
    await editor.boolean(contourIdA, contourIdB, "intersect");

    expect(layer.contours).toEqual([]);
    expect(editor.selection.ids).toEqual([]);
  });

  it("refuses boolean edits while no authored source is active", async () => {
    const layer = editor.requireGlyphLayer();
    const before = geometrySummary(layer);
    const [contourIdA, contourIdB] = selectedContours(editor);
    editor.setSourceToDefault();

    await editor.boolean(contourIdA, contourIdB, "union");

    expect(editor.activeSourceId).toBeNull();
    expect(geometrySummary(layer)).toEqual(before);
    expect(editor.selection.ids).toEqual([contourIdA, contourIdB]);

    await editor.undo();
    expectGeometry(layer, 1, 8_100, [10, 10, 100, 100]);
  });
});

function selectedContours(editor: TestEditor) {
  const [contourIdA, contourIdB] = editor.selection.ids.filter(isContourId);
  if (!contourIdA || !contourIdB) throw new Error("Expected two selected contours");

  return [contourIdA, contourIdB] as const;
}

function geometrySummary(layer: GlyphLayer) {
  const bounds = layer.bounds;

  return {
    contourCount: layer.contours.length,
    closed: layer.contours.every((contour) => contour.closed),
    area: layer.contours.reduce((total, contour) => total + Polygon.area(contour.points), 0),
    bounds: bounds ? [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y] : null,
  };
}

function expectGeometry(
  layer: GlyphLayer,
  contourCount: number,
  area: number,
  bounds: readonly number[],
) {
  const geometry = geometrySummary(layer);

  expect(geometry.contourCount).toBe(contourCount);
  expect(geometry.closed).toBe(true);
  expect(geometry.area).toBeCloseTo(area);
  expect(geometry.bounds).toEqual(bounds);
}
