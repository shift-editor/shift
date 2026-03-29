import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderSegmentHighlights } from "./segments";
import type { IRenderer } from "@/types/graphics";
import type { Glyph, Contour } from "@shift/types";
import type { Segment as SegmentType } from "@/types/segments";
import { Segment } from "@/lib/geo/Segment";
import { SEGMENT_HOVER_STYLE, SEGMENT_SELECTED_STYLE, resolveDrawStyle } from "@/lib/styles/style";
import type { RenderContext } from "./types";
import { asContourId, asPointId } from "@shift/types";
import { expectAt } from "@/testing";

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
    strokePath: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

function createRenderContext(ctx: IRenderer): RenderContext {
  const rc: RenderContext = {
    ctx,
    pxToUpm: (px?: number) => px ?? 1,
    applyStyle: (style) => {
      ctx.setStyle(resolveDrawStyle(style, (px) => rc.pxToUpm(px)));
    },
  };
  return rc;
}

function createTriangleContour(): Contour {
  return {
    id: asContourId("triangle"),
    closed: true,
    points: [
      { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: asPointId("p2"), x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: asPointId("p3"), x: 50, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createTriangleGlyph(): Glyph {
  return {
    name: "triangle",
    contours: [createTriangleContour()],
    xAdvance: 100,
    unicode: 65,
    anchors: [],
    compositeContours: [],
    activeContourId: asContourId("triangle"),
  };
}

function getSegments(contour: Contour): SegmentType[] {
  return Segment.parse(contour.points, contour.closed);
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
      renderSegmentHighlights(rc, null, []);

      expect(ctx.setStyle).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it("highlights hovered segment with SEGMENT_HOVER_STYLE", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);
      const hoveredSegment = expectAt(segments, 0);

      renderSegmentHighlights(rc, hoveredSegment, []);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_HOVER_STYLE);
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("highlights selected segment with SEGMENT_SELECTED_STYLE", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);
      const targetSegment = expectAt(segments, 0);

      renderSegmentHighlights(rc, null, [targetSegment]);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_SELECTED_STYLE);
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("selected style takes precedence over hovered", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);
      const targetSegment = expectAt(segments, 0);

      renderSegmentHighlights(rc, targetSegment, [targetSegment]);

      expect(ctx.setStyle).toHaveBeenCalledWith(SEGMENT_SELECTED_STYLE);
    });

    it("draws multiple segments when multiple are selected", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);

      renderSegmentHighlights(rc, null, segments);

      expect(ctx.setStyle).toHaveBeenCalledTimes(1);
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("only draws the hovered segment, not others", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);
      const hoveredSegment = expectAt(segments, 1);

      renderSegmentHighlights(rc, hoveredSegment, []);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("sets lineWidth from style through pxToUpm", () => {
      const glyph = createTriangleGlyph();
      const contour = expectAt(glyph.contours, 0);
      const segments = getSegments(contour);
      const hoveredSegment = expectAt(segments, 0);

      const pxToUpmSpy = vi.fn((px?: number) => (px ?? 1) * 2);
      rc.pxToUpm = pxToUpmSpy;

      renderSegmentHighlights(rc, hoveredSegment, []);

      expect(pxToUpmSpy).toHaveBeenCalledWith(SEGMENT_HOVER_STYLE.lineWidth);
    });
  });
});
