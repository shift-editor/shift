import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import { applyDynamicStroke, updateStrokeStyle } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const ROUND_40: OutlineStrokeStyle = {
  width: 40,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

describe("stroke metrics", () => {
  const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "H" });

  it("reads ink LSB in the inspector after applying a dynamic stroke", async () => {
    const [contour] = await editor.outline();
    editor.select([contour!.points[0]!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    const drawn = await editor.drawnGlyph();
    expect(drawn.skeletonLsb).not.toBeNull();
    expect(drawn.sidebearings.lsb).not.toBeNull();
    expect(drawn.sidebearings.lsb!).toBeLessThan(drawn.skeletonLsb!);
  });

  it("returns to skeleton sidebearings when include stroke is off", async () => {
    const [contour] = await editor.outline();
    editor.select([contour!.points[0]!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
    await editor.settle();

    const inkLsb = editor.glyphMetrics().lsb;
    editor.setIncludeStrokeInMetrics(false);
    await editor.settle();

    const skeletonLsb = editor.glyphMetrics().lsb;
    expect(skeletonLsb).toBeGreaterThan(inkLsb!);
  });

  describe("typing sidebearings in ink mode", () => {
    const editor = useTestEditor({
      glyphs: {
        S: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
      },
    });

    async function strokeOpenGlyph() {
      await editor.openGlyph("S");
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();
    }

    it("lands the ink left edge on a typed LSB", async () => {
      await strokeOpenGlyph();
      editor.setLeftSidebearing(50);
      await editor.settle();
      expect((await editor.drawnGlyph()).sidebearings.lsb).toBe(50);
    });

    it("lands the ink right gap on a typed RSB by moving the advance, not the ink", async () => {
      await strokeOpenGlyph();
      const before = await editor.drawnGlyph();
      editor.setRightSidebearing(30);
      await editor.settle();

      const after = await editor.drawnGlyph();
      expect(after.sidebearings).toMatchObject({ rsb: 30 });
      expect(after.sidebearings.lsb).toBe(before.sidebearings.lsb);
      expect(after.advanceWidth).toBe(before.advanceWidth + (30 - before.sidebearings.rsb!));
    });
  });

  describe("include stroke switch", () => {
    const editor = useTestEditor({
      glyphs: {
        S: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
      },
    });

    it("flips with one undo step and leaves the outline unchanged", async () => {
      await editor.openGlyph("S");
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();
      const beforeOutline = await editor.outline();

      editor.setIncludeStrokeInMetrics(false);
      await editor.settle();
      expect(await editor.outline()).toEqual(beforeOutline);

      await editor.undo();
      await editor.settle();
      expect(editor.glyphMetrics().skeletonLsb).not.toBeNull();
    });
  });

  describe("re-apply linked metrics", () => {
    const editor = useTestEditor({
      glyphs: {
        n: { outline: { advance: 500, contours: [rect(50, 0, 400, 700)] } },
        o: { outline: { advance: 520, contours: [rect(40, 0, 440, 700)] } },
      },
    });

    it("updates a linked glyph in one undo step", async () => {
      await editor.openGlyph("n");
      const [nContour] = await editor.outline();
      editor.select([nContour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();

      await editor.openGlyph("o");
      expect(editor.linkMetric("left", "=n")).toBeNull();
      await editor.settle();
      const before = (await editor.drawnGlyph()).sidebearings.lsb!;

      await editor.openGlyph("n");
      editor.select([nContour!.points[0]!.id as PointId]);
      expect(updateStrokeStyle(editor.asEditor(), { width: 80 })).toEqual({ ok: true });
      await editor.settle();

      await editor.openGlyph("o");
      editor.reapplyLinkedMetrics("glyph");
      await editor.settle();
      const after = (await editor.drawnGlyph()).sidebearings.lsb!;
      expect(after).not.toBe(before);

      await editor.undo();
      await editor.settle();
      expect((await editor.drawnGlyph()).sidebearings.lsb).toBe(before);
    });
  });

  describe("plain glyph", () => {
    const editor = useTestEditor({
      glyphs: {
        A: { outline: { advance: 500, contours: [rect(50, 0, 400, 700)] } },
      },
    });

    it("shows no skeleton secondary label on a glyph with no dynamic stroke", async () => {
      await editor.openGlyph("A");
      expect(editor.glyphMetrics()).toMatchObject({
        skeletonLsb: null,
        skeletonRsb: null,
        fallbackTooltip: null,
      });
    });
  });
});

describe("include stroke on a glyph without a stroke", () => {
  const editor = useTestEditor({
    glyphs: { P: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } } },
  });

  it("changes neither the sidebearings nor the glyph's bounds when it flips", async () => {
    await editor.openGlyph("P");
    const before = editor.glyphMetrics();
    const boundsBefore = (await editor.drawnGlyph("P")).bounds;

    editor.setIncludeStrokeInMetrics(false);
    await editor.settle();
    expect(editor.glyphMetrics()).toEqual(before);
    expect((await editor.drawnGlyph("P")).bounds).toEqual(boundsBefore);

    editor.setIncludeStrokeInMetrics(true);
    await editor.settle();
    expect(editor.glyphMetrics()).toEqual(before);
    expect((await editor.drawnGlyph("P")).bounds).toEqual(boundsBefore);
  });
});
