import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Polygon } from "@shift/geo";
import type { AxisId, ContourId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import type { ContourFixture } from "@/testing/fixtures";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
let weight: AxisId;
beforeEach(async () => {
  editor = await startTestEditor();
  weight = await editor.addAxis({ tag: "wght", minimum: 100, default: 400, maximum: 900 });
});
afterEach(() => editor.close());

function box(x0: number, y0: number, x1: number, y1: number): ContourFixture<never> {
  return {
    closed: true,
    points: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  };
}

/** Draws two closed boxes and selects both contours. */
async function drawAndSelect(...boxes: ContourFixture<never>[]): Promise<ContourId[]> {
  await editor.draw({ contours: boxes });
  const ids = (await editor.outline()).map(({ id }) => id);
  editor.selectObjects(ids);
  return ids;
}

async function geometry(e: EditorTestSurface) {
  const outline = await e.outline();
  const bounds = await e.outlineBounds();
  return {
    contours: outline.length,
    closed: outline.every(({ closed }) => closed),
    area: outline.reduce((total, contour) => total + Polygon.area(contour.points), 0),
    bounds: bounds && [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y],
  };
}

describe("combining two overlapping contours", () => {
  it.each([
    { operation: "union", contours: 1, area: 14_600, bounds: [10, 10, 150, 150] },
    { operation: "subtract", contours: 1, area: 6_500, bounds: [10, 10, 100, 100] },
    { operation: "intersect", contours: 1, area: 1_600, bounds: [60, 60, 100, 100] },
  ] as const)(
    "$operation replaces them as one undoable edit and selects the result",
    async ({ operation, contours, area, bounds }) => {
      const before = await drawAndSelect(box(10, 10, 100, 100), box(60, 60, 150, 150));
      let selected: readonly string[] = [];

      await expectEdit(
        editor,
        async (e) => {
          expect(await e.combineSelectedContours(operation)).toBe(true);
          selected = e.selectionIds();
        },
        async (e) => {
          const result = await geometry(e);
          expect(result).toMatchObject({ contours, closed: true, bounds });
          expect(result.area).toBeCloseTo(area);
        },
      );
      expect(selected).toEqual((await editor.outline()).map(({ id }) => id));

      await editor.undo();
      expect(editor.selectionIds()).toEqual(before);
      await editor.redo();
      expect(editor.selectionIds()).toEqual(selected);
    },
  );

  it("clears the selection when nothing is left", async () => {
    await drawAndSelect(box(10, 10, 100, 100), box(260, 60, 350, 150));

    await editor.combineSelectedContours("intersect");

    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("does nothing while an interpolated location is shown", async () => {
    const defaultSource = editor.editorView().activeSourceId!;
    const selection = await drawAndSelect(box(10, 10, 100, 100), box(60, 60, 150, 150));
    const before = await editor.outline();
    editor.setLocation({ [weight]: 550 });

    await editor.combineSelectedContours("union");

    expect(editor.editorView().activeSourceId).toBeNull();
    expect(editor.selectionIds()).toEqual(selection);
    editor.selectSource(defaultSource);
    expect(await editor.outline()).toEqual(before);
    await editor.undo();
    expect(await editor.outline()).toEqual([]);
  });
});
