import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderSegmentHighlights } from "./segments";
import type { IRenderer } from "@/types/graphics";
import type { Glyph, Contour } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import { Segment } from "@/lib/geo/Segment";
import { SEGMENT_HOVER_STYLE, SEGMENT_SELECTED_STYLE } from "@/lib/styles/style";
import type { RenderContext } from "./types";

function createMockRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "white",
    antiAlias: false,
    dashPattern: [],
    setStyle: vi.fn(),
    drawLine: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillCircle: vi.fn(),
    strokeCircle: vi.fn(),
    createPath: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadTo: vi.fn(),
    cubicTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillPath: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

function createRenderContext(ctx: IRenderer): RenderContext {
  return {
    ctx,
    lineWidthUpm: (px?: number) => px ?? 1,
  };
}

function createTriangleContour(): Contour {
  return {
    id: 0,
    closed: true,
    points: [
      { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: 2, x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: 3, x: 50, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createTriangleGlyph(): Glyph {
  return {
    name: "triangle",
    contours: [createTriangleContour()],
    xAdvance: 100,
  };
}

function getSegmentIds(contour: Contour): SegmentId[] {
  const segments = Segment.parse(contour.points, contour.closed);
  return segments.map((s) => Segment.id(s));
}

describe("segments", () => {
  let ctx: IRenderer;
  let rc: RenderContext;

  beforeEach(() => {
    ctx = createMockRenderer();
    rc = createRenderContext(ctx);
  });

  describe("renderSegmentHighlights", () => {
    it("does nothing if no hovered or selected segments", () => {
      const glyph = createTriangleGlyph();

      renderSegmentHighlights(rc, glyph, null, () => false);

      expect(ctx.setStyle).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it("highlights hovered segment with SEGMENT_HOVER_STYLE", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);
      const hoveredId = segmentIds[0];

      renderSegmentHighlights(rc, glyph, hoveredId, () => false);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_HOVER_STYLE);
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("highlights selected segment with SEGMENT_SELECTED_STYLE", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);
      const targetId = segmentIds[0];

      renderSegmentHighlights(rc, glyph, null, (id) => id === targetId);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_SELECTED_STYLE);
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("selected style takes precedence over hovered", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);
      const targetId = segmentIds[0];

      renderSegmentHighlights(rc, glyph, targetId, (id) => id === targetId);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_SELECTED_STYLE);
    });

    it("draws multiple segments when multiple are selected", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);

      renderSegmentHighlights(rc, glyph, null, (id) => segmentIds.includes(id));

      expect(ctx.setStyle).toHaveBeenCalledTimes(3);
      expect(ctx.beginPath).toHaveBeenCalledTimes(3);
      expect(ctx.stroke).toHaveBeenCalledTimes(3);
    });

    it("only draws the hovered segment, not others", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);
      const hoveredId = segmentIds[1];

      renderSegmentHighlights(rc, glyph, hoveredId, () => false);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("sets lineWidth from style through lineWidthUpm", () => {
      const glyph = createTriangleGlyph();
      const contour = glyph.contours[0];
      const segmentIds = getSegmentIds(contour);
      const hoveredId = segmentIds[0];

      const lineWidthUpmSpy = vi.fn((px?: number) => (px ?? 1) * 2);
      rc.lineWidthUpm = lineWidthUpmSpy;

      renderSegmentHighlights(rc, glyph, hoveredId, () => false);

      expect(lineWidthUpmSpy).toHaveBeenCalledWith(SEGMENT_HOVER_STYLE.lineWidth);
    });
  });
});
