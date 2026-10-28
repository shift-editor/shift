import { describe, expect, it } from "vitest";
import { Polygon } from "@shift/geo";
import type { ContourId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { rect, type ContourFixture } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

const editor = useTestEditor({ axes: [WEIGHT] });

/** Draws two closed boxes and selects both contours. */
async function drawAndSelect(...boxes: ContourFixture[]): Promise<ContourId[]> {
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
      const before = await drawAndSelect(rect(10, 10, 90, 90), rect(60, 60, 90, 90));
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
    await drawAndSelect(rect(10, 10, 90, 90), rect(260, 60, 90, 90));

    await editor.combineSelectedContours("intersect");

    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("does nothing while an interpolated location is shown", async () => {
    const selection = await drawAndSelect(rect(10, 10, 90, 90), rect(60, 60, 90, 90));
    const before = await editor.outline();
    editor.setLocation({ wght: 550 });

    await editor.combineSelectedContours("union");

    expect(editor.editorView().activeSourceId).toBeNull();
    expect(editor.selectionIds()).toEqual(selection);
    editor.clickSource("Regular");
    expect(await editor.outline()).toEqual(before);
    await editor.undo();
    expect(await editor.outline()).toEqual([]);
  });
});
