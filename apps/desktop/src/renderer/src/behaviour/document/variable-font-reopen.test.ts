import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();

/**
 * A Regular square, and a Bold source at wght 900 (design 800) with its corner moved, a wider advance and taller metrics.
 *
 * Kept: both tests author the same font through the user's steps, which a font fixture cannot express (a mapping, metrics, an instance, a dragged point).
 *
 * @returns the id of Bold's moved corner.
 */
async function authorVariableFont(): Promise<PointId> {
  const { corner } = await editor.draw({
    advance: 400,
    contours: [
      {
        closed: true,
        points: [{ x: 0, y: 0, name: "corner" }, [100, 0], [100, 100], [0, 100]],
      },
    ],
  });
  await editor.addAxis({ ...WEIGHT, name: "Weight" });
  await editor.setAxisMapping("wght", [
    [100, 100],
    [400, 400],
    [900, 800],
  ]);
  await editor.addSource("Bold", { wght: 900 });
  editor.clickSource("Regular");
  const boldCorner = (await editor.point(corner, { source: { name: "Bold" } }))!.id;

  editor.clickSource("Bold");
  await editor.dragPoint(boldCorner, { x: 40, y: 20 });
  editor.setAdvanceWidth(700);
  await editor.setSourceMetric("Bold", "Ascender", 920);
  await editor.setSourceMetric("Bold", "x-Height", 620);
  editor.addInstance("Bold", { wght: 900 });
  await editor.settle();
  editor.clickSource("Regular");
  return boldCorner;
}

describe("saving and reopening a variable font", () => {
  it("keeps the axes, sources, layers, instances and the glyph between sources", async () => {
    await authorVariableFont();
    const middle = { wght: 650 };
    expect(editor.locationAt({ wght: 900 })).toMatchObject({ designLocation: [{ value: 800 }] });
    expect(editor.locationAt(middle)).toMatchObject({
      designLocation: [{ value: 600 }],
      sourceId: null,
      metrics: { ascender: 860, xHeight: 560 },
    });
    expect(await editor.glyphAt(middle)).toMatchObject({ advanceWidth: 550 });
    await expect(editor.save()).resolves.toMatchObject({ dirty: false });
    const font = editor.fontOverview();
    const glyph = editor.glyphNamed("A");
    const between = editor.locationAt(middle);
    const drawnBetween = await editor.glyphAt(middle);
    editor.clickSource("Bold");
    const boldOutline = await editor.outline();

    const reopened = await editor.reopen();
    try {
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });
      expect(reopened.fontOverview()).toEqual(font);
      expect(reopened.glyphNamed("A")).toEqual(glyph);
      expect(reopened.locationAt(middle)).toEqual(between);
      expect(await reopened.glyphAt(middle)).toEqual(drawnBetween);
      reopened.clickSource("Bold");
      expect(await reopened.outline()).toEqual(boldOutline);
    } finally {
      await reopened.close();
    }
  });

  it("goes on editing a reopened source, with undo back to the saved document", async () => {
    const corner = await authorVariableFont();
    const reopened = await editor.reopen();
    try {
      reopened.clickSource("Bold");
      const saved = (await reopened.point(corner))!;

      await reopened.dragPoint(corner, { x: 20, y: 30 });
      const edited = { x: saved.x + 20, y: saved.y + 30 };
      expect(await reopened.point(corner)).toMatchObject(edited);
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: true });

      await reopened.undo();
      expect(await reopened.point(corner)).toEqual(saved);
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });

      await reopened.redo();
      expect(await reopened.point(corner)).toMatchObject(edited);
    } finally {
      await reopened.close();
    }
  });
});
