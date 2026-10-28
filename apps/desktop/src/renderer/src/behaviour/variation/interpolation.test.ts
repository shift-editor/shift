import { beforeEach, describe, expect, it } from "vitest";
import { square } from "@/testing/fixtures";
import { FONTS, useTestEditor, WEIGHT } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

/** The rightmost edge of what the canvas draws. */
async function drawnRight(editor: EditorTestSurface): Promise<number> {
  const { bounds } = await editor.drawnGlyph();
  if (!bounds) throw new Error("Expected a drawn outline");
  return bounds.max.x;
}

describe("sources on a mapped axis", () => {
  const editor = useTestEditor({ glyphs: { A: { outline: { advance: 300 } } }, axes: [WEIGHT] });

  it("places a new source at the mapped location and activates it there", async () => {
    await editor.setAxisMapping("wght", [
      [100, 100],
      [400, 400],
      [900, 800],
    ]);

    await editor.addSource("Black", { wght: 900 });
    editor.setAdvanceWidth(500);
    await editor.settle();

    const black = editor.fontOverview().sources.filter(({ name }) => name === "Black");
    expect(black).toHaveLength(1);
    expect(Object.values(black[0]!.location.values)[0]).toBeCloseTo(800);
    expect(editor.location().sourceId).toBe(black[0]!.id);

    const regular = editor.fontOverview().sources[0]!.name;
    await editor.editSources([regular]);
    editor.setLocation({ wght: 900 });
    expect(editor.location().sourceId).toBe(black[0]!.id);
    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);

    await editor.editSources([regular]);
    await editor.editSources(["Black"]);
    expect(editor.location().externalLocation[0]?.value).toBeCloseTo(900);
    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);
  });
});

describe("mapped weights keep design-space interpolation", () => {
  const editor = useTestEditor({ file: FONTS.mappedWeight, glyph: "A" });

  it.each([
    [100, 30, 300, 700],
    [250, 58, 450, 750],
    [400, 86, 600, 800],
    [681.25, 123, 750, 850],
    [800, 160, 900, 900],
  ])(
    "draws weight %s with the mapped outline, advance, and metrics",
    async (weight, right, advance, ascender) => {
      editor.setLocation({ wght: weight });

      expect(await drawnRight(editor)).toBeCloseTo(right);
      expect((await editor.drawnGlyph()).advanceWidth).toBeCloseTo(advance);
      expect(editor.location().metrics.ascender).toBeCloseTo(ascender);
    },
  );

  it("keeps the mapped interpolation after saving and reopening", async () => {
    const reopened = await editor.reopen();
    try {
      reopened.setLocation({ wght: 250 });
      expect((await reopened.drawnGlyph()).advanceWidth).toBeCloseTo(450);
      expect((await reopened.drawnGlyph()).bounds?.max.x).toBeCloseTo(58);
      expect(reopened.location().metrics.ascender).toBeCloseTo(750);
    } finally {
      await reopened.close();
    }
  });

  it("redraws the glyph and metrics when the mapping changes, and undo restores them", async () => {
    editor.setLocation({ wght: 681.25 });
    expect((await editor.drawnGlyph()).advanceWidth).toBeCloseTo(750);

    await editor.setAxisMapping("wght", [
      [100, 30],
      [200, 50],
      [300, 66],
      [400, 86],
      [500, 102],
      [600, 134],
      [700, 166],
      [800, 234],
    ]);

    expect((await editor.drawnGlyph()).advanceWidth).toBeCloseTo(900);
    expect(await drawnRight(editor)).toBeCloseTo(160);
    expect(editor.location().metrics.ascender).toBeCloseTo(900);

    await editor.undo();
    await editor.settle();
    expect((await editor.drawnGlyph()).advanceWidth).toBeCloseTo(750);
    expect(editor.location().metrics.ascender).toBeCloseTo(850);
  });
});

describe("editing a variable glyph across sources", () => {
  let regular: string;

  /** Regular: a 100-unit square, advance 300. Bold (wght 700): a 200-unit-wide box, advance 500, taller ascender and x-height. */
  const editor = useTestEditor({
    glyphs: { A: { outline: { advance: 300, contours: [square(100)] } } },
    axes: [WEIGHT],
    sources: { Bold: { wght: 700 } },
  });
  beforeEach(async () => {
    regular = editor.fontOverview().sources[0]!.name;
    await editor.setSourceMetric("Bold", "Ascender", 900);
    await editor.setSourceMetric("Bold", "x-Height", 600);
    await editor.editSources(["Bold"]);
    editor.setAdvanceWidth(500);
    await editor.settle();
    const right = [
      await editor.pointAt({ x: 100, y: 0 }),
      await editor.pointAt({ x: 100, y: 100 }),
    ];
    editor.select(right.map((point) => point!.id));
    await editor.dragPoint(right[0]!.id, { x: 100, y: 0 });
  });

  it("shows the glyph's own layer at a non-default source", async () => {
    const bold = await editor.layerAt("Bold");

    expect(bold.contours).toHaveLength(1);
    expect(bold.advanceWidth).toBe(500);
    expect(bold.bounds).toMatchObject({ max: { x: 200, y: 100 } });
  });

  it("edits a non-default source and undoes it", async () => {
    const corner = await editor.pointAt({ x: 200, y: 0 });
    editor.select([corner!.id]);

    await editor.dragPoint(corner!.id, { x: 50, y: 0 });
    expect(await editor.point(corner!.id)).toMatchObject({ x: 250, y: 0 });

    await editor.undo();
    await editor.settle();
    expect(await editor.point(corner!.id)).toMatchObject({ x: 200, y: 0 });
  });

  it("interpolates the outline, advance, and metrics between sources", async () => {
    editor.setLocation({ wght: 550 });

    expect(editor.location().sourceId).toBeNull();
    expect((await editor.drawnGlyph()).advanceWidth).toBeCloseTo(400);
    expect(await drawnRight(editor)).toBeCloseTo(150);
    expect(editor.location().metrics.ascender).toBeCloseTo(850);
    expect(editor.location().metrics.xHeight).toBeCloseTo(550);
  });

  it("gives a new source between them the interpolated outline and metrics, with its own point ids", async () => {
    await editor.addSource("Medium", { wght: 550 });

    const medium = await editor.layerAt("Medium");
    expect(medium.advanceWidth).toBeCloseTo(400);
    expect(medium.bounds?.max.x).toBeCloseTo(150);
    const regularIds = (await editor.layerAt(regular)).contours[0]?.points.map(({ id }) => id);
    expect(medium.contours[0]?.points.map(({ id }) => id)).not.toEqual(regularIds);
    expect(editor.location().sourceId).not.toBeNull();
    expect(editor.location().metrics.ascender).toBeCloseTo(850);
    expect(editor.location().metrics.xHeight).toBeCloseTo(550);
  });

  it("draws a source's own layer at its exact location", async () => {
    await editor.editSources([regular]);
    editor.setLocation({ wght: 700 });

    const bold = editor.fontOverview().sources.filter(({ name }) => name === "Bold");
    expect(editor.location().sourceId).toBe(bold[0]?.id);
    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);
  });

  it("redraws the interpolated glyph after a source's advance changes", async () => {
    editor.setAdvanceWidth(700);
    await editor.settle();

    editor.setLocation({ wght: 550 });

    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);
  });
});
