import { describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { square } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();

/** A Regular square, and a Bold source at wght 900 (design 800) with its corner moved, a wider advance and taller metrics. */
async function authorVariableFont(): Promise<void> {
  await editor.draw({
    advance: 400,
    contours: [square(100)],
  });
  await editor.addAxis({ ...WEIGHT, name: "Weight" });
  await editor.setAxisMapping("wght", [
    [100, 100],
    [400, 400],
    [900, 800],
  ]);
  await editor.addSource("Bold", { wght: 900 });

  editor.clickSource("Bold");
  const boldCorner = (await editor.outline())[0]!.points[0]!.id;
  await editor.dragPoint(boldCorner, { x: 40, y: 20 });
  editor.setAdvanceWidth(700);
  await editor.setSourceMetric("Bold", "Ascender", 920);
  await editor.setSourceMetric("Bold", "x-Height", 620);
  editor.addInstance("Bold", { wght: 900 });
  await editor.settle();
  editor.clickSource("Regular");
}

/** Everything about the variable font a reopened document must give back unchanged. */
async function variableFont(surface: EditorTestSurface) {
  const middle = { wght: 650 };
  return {
    font: surface.fontOverview(),
    glyph: surface.glyphNamed("A"),
    middle: { location: surface.locationAt(middle), glyph: await surface.glyphAt(middle) },
  };
}

describe("saving and reopening a variable font", () => {
  it("keeps the axes, sources, layers, instances and the glyph between sources", async () => {
    await authorVariableFont();
    const middle = { wght: 650 };
    expect(editor.locationAt({ wght: 900 }).designLocation.map(({ value }) => value)).toEqual([
      800,
    ]);
    expect(editor.locationAt(middle)).toMatchObject({
      designLocation: [{ value: 600 }],
      sourceId: null,
      metrics: { ascender: 860, xHeight: 560 },
    });
    expect((await editor.glyphAt(middle))?.advanceWidth).toBe(550);
    await expect(editor.save()).resolves.toMatchObject({ dirty: false });
    const saved = await variableFont(editor);
    editor.clickSource("Bold");
    const boldOutline = await editor.outline();

    const reopened = await editor.reopen();
    try {
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });
      expect(await variableFont(reopened)).toEqual(saved);
      reopened.clickSource("Bold");
      expect(await reopened.outline()).toEqual(boldOutline);
    } finally {
      await reopened.close();
    }
  });

  it("goes on editing a reopened source, with undo back to the saved document", async () => {
    await authorVariableFont();
    const reopened = await editor.reopen();
    try {
      reopened.clickSource("Bold");
      const corner = (await reopened.outline())[0]!.points[0]!.id;
      const saved = await reopened.pointPositions([corner]);

      await reopened.dragPoint(corner, { x: 20, y: 30 });
      const edited = { [corner]: { x: saved[corner]!.x + 20, y: saved[corner]!.y + 30 } };
      expect(await reopened.pointPositions([corner])).toEqual(edited);
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: true });

      await reopened.undo();
      expect(await reopened.pointPositions([corner])).toEqual(saved);
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });

      await reopened.redo();
      expect(await reopened.pointPositions([corner])).toEqual(edited);
    } finally {
      await reopened.close();
    }
  });
});
