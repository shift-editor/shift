import { beforeEach, describe, expect, it } from "vitest";
import { square } from "@/testing/fixtures";
import { FONTS, useTestEditor, WEIGHT } from "@/testing/fontFixture";

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

    const black = editor.source({ name: "Black" });
    expect(black).not.toBeNull();
    expect(Object.values(black!.location.values)[0]).toBeCloseTo(800);
    expect(editor.location()).toMatchObject({ sourceId: black!.id });

    const regular = editor.fontOverview().sources[0]!.name;
    await editor.editSources([regular]);
    editor.setLocation({ wght: 900 });
    expect(editor.location()).toMatchObject({ sourceId: black!.id });
    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);

    await editor.editSources([regular]);
    await editor.editSources(["Black"]);
    expect(editor.location()).toMatchObject({ externalLocation: [{ value: expect.closeTo(900) }] });
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

      expect(await editor.drawnGlyph()).toMatchObject({
        bounds: { max: { x: expect.closeTo(right) } },
        advanceWidth: expect.closeTo(advance),
      });
      expect(editor.location().metrics.ascender).toBeCloseTo(ascender);
    },
  );

  it("keeps the mapped interpolation after saving and reopening", async () => {
    const reopened = await editor.reopen();
    try {
      reopened.setLocation({ wght: 250 });
      expect(await reopened.drawnGlyph()).toMatchObject({
        advanceWidth: expect.closeTo(450),
        bounds: { max: { x: expect.closeTo(58) } },
      });
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

    expect(await editor.drawnGlyph()).toMatchObject({
      advanceWidth: expect.closeTo(900),
      bounds: { max: { x: expect.closeTo(160) } },
    });
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
    const bold = { source: { name: "Bold" } };
    const right = [
      await editor.point((await editor.pointAt({ x: 100, y: 0 }))!.id, bold),
      await editor.point((await editor.pointAt({ x: 100, y: 100 }))!.id, bold),
    ];
    await editor.setSourceMetric("Bold", "Ascender", 900);
    await editor.setSourceMetric("Bold", "x-Height", 600);
    await editor.editSources(["Bold"]);
    editor.setAdvanceWidth(500);
    await editor.settle();
    editor.select(right.map((point) => point!.id));
    await editor.dragPoint(right[0]!.id, { x: 100, y: 0 });
  });

  it("shows the glyph's own layer at a non-default source", async () => {
    const bold = await editor.layerAt("Bold");

    expect(bold).toMatchObject({
      contours: [expect.anything()],
      advanceWidth: 500,
      bounds: { max: { x: 200, y: 100 } },
    });
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
    expect(await editor.drawnGlyph()).toMatchObject({
      advanceWidth: expect.closeTo(400),
      bounds: { max: { x: expect.closeTo(150) } },
    });
    expect(editor.location().metrics.ascender).toBeCloseTo(850);
    expect(editor.location().metrics.xHeight).toBeCloseTo(550);
  });

  it("gives a new source between them the interpolated outline and metrics, with its own point ids", async () => {
    await editor.addSource("Medium", { wght: 550 });

    const medium = await editor.layerAt("Medium");
    expect(medium).toMatchObject({
      advanceWidth: expect.closeTo(400),
      bounds: { max: { x: expect.closeTo(150) } },
    });
    const regularIds = (await editor.layerAt(regular)).contours[0]?.points.map(({ id }) => id);
    expect(medium.contours[0]?.points.map(({ id }) => id)).not.toEqual(regularIds);
    expect(editor.location().sourceId).not.toBeNull();
    expect(editor.location().metrics.ascender).toBeCloseTo(850);
    expect(editor.location().metrics.xHeight).toBeCloseTo(550);
  });

  it("draws a source's own layer at its exact location", async () => {
    await editor.editSources([regular]);
    editor.setLocation({ wght: 700 });

    expect(editor.location()).toMatchObject({ sourceId: editor.source({ name: "Bold" })!.id });
    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);
  });

  it("redraws the interpolated glyph after a source's advance changes", async () => {
    editor.setAdvanceWidth(700);
    await editor.settle();

    editor.setLocation({ wght: 550 });

    expect((await editor.drawnGlyph()).advanceWidth).toBe(500);
  });
});
