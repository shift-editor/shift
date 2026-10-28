import { describe, expect, it } from "vitest";
import { Polygon } from "@shift/geo";
import { expectEdit } from "@/testing/expectEdit";
import { rect } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor({ axes: [WEIGHT] });

describe("combining two overlapping contours", () => {
  it.each([
    {
      operation: "union",
      contours: 1,
      area: 14_600,
      bounds: { min: { x: 10, y: 10 }, max: { x: 150, y: 150 } },
    },
    {
      operation: "subtract",
      contours: 1,
      area: 6_500,
      bounds: { min: { x: 10, y: 10 }, max: { x: 100, y: 100 } },
    },
    {
      operation: "intersect",
      contours: 1,
      area: 1_600,
      bounds: { min: { x: 60, y: 60 }, max: { x: 100, y: 100 } },
    },
  ] as const)(
    "$operation replaces them as one undoable edit and selects the result",
    async ({ operation, contours, area, bounds }) => {
      await editor.draw({ contours: [rect(10, 10, 90, 90), rect(60, 60, 90, 90)] });
      const before = (await editor.outline()).map(({ id }) => id);
      editor.selectObjects(before);
      let selected: readonly string[] = [];

      await expectEdit(
        editor,
        async (e) => {
          expect(await e.combineSelectedContours(operation)).toBe(true);
          selected = e.selectionIds();
        },
        async (e) => {
          const outline = await e.outline();
          expect(outline).toHaveLength(contours);
          expect(outline.every(({ closed }) => closed)).toBe(true);
          expect(await e.outlineBounds()).toEqual(bounds);
          const areas = outline.map(({ points }) => Polygon.area(points));
          expect(areas.reduce((total, each) => total + each, 0)).toBeCloseTo(area);
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
    await editor.draw({ contours: [rect(10, 10, 90, 90), rect(260, 60, 90, 90)] });
    editor.selectObjects((await editor.outline()).map(({ id }) => id));

    await editor.combineSelectedContours("intersect");

    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("does nothing while an interpolated location is shown", async () => {
    await editor.draw({ contours: [rect(10, 10, 90, 90), rect(60, 60, 90, 90)] });
    const selection = (await editor.outline()).map(({ id }) => id);
    editor.selectObjects(selection);
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
