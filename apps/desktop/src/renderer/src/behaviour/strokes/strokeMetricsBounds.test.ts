import { describe, expect, it } from "vitest";
import { Bounds } from "@shift/geo";
import type { PointId } from "@shift/types";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const ROUND_40 = {
  width: 40,
  cap: "round" as const,
  join: "round" as const,
  miterLimit: 4,
  position: 0,
};

const INK_LAND_TOLERANCE = 0.25;

async function strokeWholeContour(editor: ReturnType<typeof useTestEditor>) {
  const [contour] = await editor.outline();
  editor.select(contour!.points.map((point) => point.id as PointId));
  expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
  await editor.settle();
  return contour!;
}

describe("stroke metrics transform bounds", () => {
  describe("ink bounds, move", () => {
    const editor = useTestEditor({
      glyphs: {
        o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      },
    });

    it("lands the ink bottom on a typed Y minimum for a whole stroked contour", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const before = editor.transformPanelBounds();
      expect(before?.measure).toBe("ink");
      const targetY = -10;
      editor.setTransformPanelY(targetY);
      await editor.settle();

      const after = editor.transformPanelBounds();
      const deltaY = targetY - before!.bounds.min.y;
      expect(Math.round(after!.bounds.min.y)).toBe(targetY);
      expect(Math.round(after!.bounds.max.y - before!.bounds.max.y)).toBe(Math.round(deltaY));
    });

    it("records one undo step for a move edit", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const before = editor.transformPanelBounds()!;
      editor.setTransformPanelY(-10);
      await editor.settle();

      const moved = editor.transformPanelBounds()!;
      expect(Math.round(moved.bounds.min.y)).toBe(-10);

      await editor.undo();
      await editor.settle();
      const undone = editor.transformPanelBounds()!;
      expect(Math.round(undone.bounds.min.y)).toBe(Math.round(before.bounds.min.y));
    });
  });

  describe("ink bounds, resize", () => {
    const editor = useTestEditor({
      glyphs: {
        o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      },
    });

    it("lands the ink height within solve tolerance", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const before = editor.transformPanelBounds()!;
      expect(before.measure).toBe("ink");
      const targetHeight = Math.round(Bounds.height(before.bounds) * 0.8);
      editor.setTransformPanelHeight(targetHeight);
      await editor.settle();

      const after = editor.transformPanelBounds()!;
      expect(Math.abs(Bounds.height(after.bounds) - targetHeight)).toBeLessThanOrEqual(
        INK_LAND_TOLERANCE,
      );
    });

    it("refuses a height below the stroke and leaves geometry unchanged", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const beforeBounds = editor.transformPanelBounds()!;
      const beforeY = (await editor.outline())[0]!.points[0]!.y;

      expect(() => editor.setTransformPanelHeightUnchecked(8)).toThrow();

      await editor.settle();
      const afterBounds = editor.transformPanelBounds()!;
      const afterY = (await editor.outline())[0]!.points[0]!.y;
      expect(Bounds.equals(afterBounds!.bounds, beforeBounds.bounds)).toBe(true);
      expect(afterY).toBe(beforeY);
    });
  });

  describe("sibling glyph and component", () => {
    const editor = useTestEditor({
      glyphs: {
        o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
        oref: { outline: { advance: 600, components: [{ glyph: "o" }] } },
      },
    });

    it("lands the same ink bottom from the same typed Y minimum", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const targetY = -10;

      async function landGlyphBottom(glyph: "o" | "oref") {
        await editor.openGlyph(glyph);
        if (glyph === "oref") {
          const [component] = await editor.components();
          editor.selectObjects([component!.id]);
        } else {
          const [contour] = await editor.outline();
          editor.select(contour!.points.map((point) => point.id as PointId));
        }
        await editor.settle();
        expect(editor.transformPanelBounds()).toMatchObject({ measure: "ink" });
        editor.setTransformPanelY(targetY);
        await editor.settle();
        return editor.transformPanelBounds()!.bounds.min.y;
      }

      const baseBottom = await landGlyphBottom("o");
      const refBottom = await landGlyphBottom("oref");
      expect(Math.abs(baseBottom - targetY)).toBeLessThanOrEqual(INK_LAND_TOLERANCE);
      expect(Math.abs(refBottom - targetY)).toBeLessThanOrEqual(INK_LAND_TOLERANCE);
      expect(Math.abs(baseBottom - refBottom)).toBeLessThanOrEqual(INK_LAND_TOLERANCE);
    });
  });

  describe("partial selection", () => {
    const editor = useTestEditor({
      glyphs: {
        o: { outline: { advance: 600, contours: [rect(-80, -80, 160, 160)] } },
      },
    });

    it("shows the skeleton box with a skeleton label", async () => {
      await editor.openGlyph("o");
      const [contour] = await editor.outline();
      editor.select([contour!.points[0]!.id as PointId]);
      expect(applyDynamicStroke(editor.asEditor(), ROUND_40)).toEqual({ ok: true });
      await editor.settle();

      const transform = editor.transformPanelBounds();
      const skeleton = editor.skeletonSelectionBounds();
      expect(transform?.measure).toBe("skeleton");
      expect(Bounds.equals(transform!.bounds, skeleton)).toBe(true);
    });
  });

  describe("include stroke off", () => {
    const editor = useTestEditor({
      glyphs: {
        o: { outline: { advance: 600, contours: [rect(100, 100, 200, 200)] } },
      },
    });

    it("reads the skeleton selection bounds", async () => {
      await editor.openGlyph("o");
      await strokeWholeContour(editor);

      const transformInk = editor.transformPanelBounds();
      editor.setIncludeStrokeInMetrics(false);
      await editor.settle();
      const transformSkeleton = editor.transformPanelBounds();
      expect(transformSkeleton?.measure).toBe("skeleton");
      expect(transformSkeleton!.bounds.max.x).toBeLessThanOrEqual(transformInk!.bounds.max.x);
    });
  });
});
