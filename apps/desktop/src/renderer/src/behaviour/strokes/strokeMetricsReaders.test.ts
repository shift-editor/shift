import { beforeEach, describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const ROUND_40: OutlineStrokeStyle = {
  width: 40,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

describe("stroke metrics readers", () => {
  describe("spacing tool", () => {
    const editor = useTestEditor({
      glyphs: { A: { outline: { advance: 500, contours: [rect(100, 100, 200, 200)] } } },
    });
    beforeEach(async () => {
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      editor.selectTool("text");
      editor.typeText("AA");
      await editor.pressKey("Escape");
      await editor.settle();
      editor.selectTool("spacing");
    });

    it("reads ink sidebearings in the gap between glyphs", async () => {
      editor.movePointerTo({ x: 450, y: 200 });
      const inkRsb = editor.spacingTool()!.hovered!.gap.left!.sidebearing;

      editor.setIncludeStrokeInMetrics(false);
      await editor.settle();
      editor.movePointerTo({ x: 450, y: 200 });

      const skeletonRsb = editor.spacingTool()!.hovered!.gap.left!.sidebearing;
      expect(skeletonRsb).toBeGreaterThan(inkRsb);
    });
  });

  describe("render model of a text-run glyph", () => {
    const editor = useTestEditor({
      glyphs: {
        S: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
      },
    });

    it("reads ink sidebearings, and skeleton ones when include stroke is off", async () => {
      await editor.openGlyph("S");
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();

      editor.selectTool("text");
      editor.typeText("S");
      await editor.pressKey("Escape");
      await editor.settle();

      const ink = (await editor.drawnGlyph("S")).sidebearings;
      editor.setIncludeStrokeInMetrics(false);
      await editor.settle();
      const skeleton = (await editor.drawnGlyph("S")).sidebearings;

      expect(ink.lsb).toBeLessThan(skeleton.lsb!);
      expect(ink.rsb).toBeLessThan(skeleton.rsb!);
    });
  });

  describe("transform keeping the right edge", () => {
    const editor = useTestEditor({
      glyphs: {
        A: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
      },
    });

    it("keeps the ink right sidebearing when scaling from the right edge", async () => {
      editor.selectTool("text");
      editor.typeText("A");
      await editor.pressKey("Escape");
      await editor.settle();
      await editor.openGlyph("A");
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();
      editor.selectTool("text");
      await editor.settle();

      const before = (await editor.drawnGlyph("A")).sidebearings;
      await editor.clickAt({ x: 700, y: 200 });
      await editor.dragFrom({ x: 800, y: 200 }, { x: 850, y: 200 }, { altKey: true });

      const after = (await editor.drawnGlyph("A")).sidebearings;
      expect(after.rsb).toBe(before.rsb);
      expect(after.lsb).toBeLessThan(100);
    });
  });

  describe("font multi-glyph sidebearing edit", () => {
    const editor = useTestEditor({
      glyphs: {
        S: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
        T: { outline: { advance: 600, contours: [rect(120, 100, 200, 200)] } },
      },
    });

    it("lands the ink left sidebearing on several glyphs from the grid", async () => {
      for (const name of ["S", "T"] as const) {
        await editor.openGlyph(name);
        const [contour] = await editor.outline();
        editor.select([contour!.points[0]!.id as PointId]);
        expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
        await editor.settle();
      }

      await editor.setSidebearings(["S", "T"], { kind: "set", set: 120 }, { kind: "keep" });
      await editor.settle();

      for (const name of ["S", "T"] as const) {
        await editor.openGlyph(name);
        const inkLsb = (await editor.drawnGlyph()).sidebearings.lsb!;
        expect(inkLsb).toBe(120);
      }
    });
  });

  describe("drag preview", () => {
    const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "H" });

    it("follows ink sidebearings each preview frame and after release", async () => {
      const [contour] = await editor.outline();
      const pointId = contour!.points[0]!.id as PointId;
      editor.select([pointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();

      const point = contour!.points[0]!;
      const startLsb = editor.glyphMetrics().lsb!;

      editor.pressAt({ x: point.x, y: point.y });
      editor.movePointerTo({ x: point.x + 40, y: point.y });
      const midLsb = editor.glyphMetrics().lsb!;
      expect(midLsb).not.toBe(startLsb);

      editor.movePointerTo({ x: point.x + 80, y: point.y });
      editor.passFrame();
      const endPreviewLsb = editor.glyphMetrics().lsb!;

      await editor.releaseAt({ x: point.x + 80, y: point.y });
      await editor.settle();

      expect(editor.glyphMetrics().lsb).toBe(endPreviewLsb);
    });
  });

  describe("measure fallbacks", () => {
    const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "A" });

    it("reads skeleton sidebearings between masters with a reason", async () => {
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();

      editor.setLocation({ wdth: 0, wght: 500 });
      await editor.settle();

      const { lsb, fallbackTooltip } = editor.glyphMetrics();
      expect(fallbackTooltip).toMatch(/Between masters/i);
      expect(lsb).not.toBeNull();
    });

    it("reads skeleton sidebearings when the stroke cannot be solved", async () => {
      editor.selectTool("pen");
      await editor.clickAt({ x: 100, y: 100 });
      await editor.clickAt({ x: 400, y: 100 });
      await editor.pressKey("Escape");
      editor.selectTool("select");
      const line = (await editor.outline()).at(-1)!;
      const [start, end] = line.points;
      editor.select([start!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();
      await editor.dragPoint(end!.id as PointId, { x: -300, y: 0 });
      await editor.settle();

      const { lsb, fallbackTooltip } = editor.glyphMetrics();
      expect(fallbackTooltip).toMatch(/could not be solved/i);
      expect(lsb).toBeGreaterThanOrEqual(0);
    });
  });
});
