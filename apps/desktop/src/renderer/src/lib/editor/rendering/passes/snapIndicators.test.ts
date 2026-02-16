import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderSnapIndicators, collectLineEndpoints } from "./snapIndicators";
import type { IRenderer } from "@/types/graphics";
import { resolveDrawStyle } from "@/lib/styles/style";
import type { SnapIndicator } from "../../snapping/types";
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

describe("snapIndicators", () => {
  let ctx: IRenderer;
  let rc: RenderContext;

  beforeEach(() => {
    ctx = createMockRenderer();
    rc = createRenderContext(ctx);
  });

  describe("collectLineEndpoints", () => {
    it("returns all unique endpoints from lines", () => {
      const lines = [
        { from: { x: 0, y: 100 }, to: { x: 200, y: 100 } },
        { from: { x: 100, y: 0 }, to: { x: 100, y: 200 } },
      ];

      const endpoints = collectLineEndpoints(lines);

      expect(endpoints).toEqual([
        { x: 0, y: 100 },
        { x: 200, y: 100 },
        { x: 100, y: 0 },
        { x: 100, y: 200 },
      ]);
    });

    it("deduplicates shared endpoints", () => {
      const lines = [
        { from: { x: 0, y: 100 }, to: { x: 100, y: 100 } },
        { from: { x: 100, y: 100 }, to: { x: 200, y: 100 } },
      ];

      const endpoints = collectLineEndpoints(lines);

      expect(endpoints).toEqual([
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]);
    });

    it("returns empty array for empty lines", () => {
      const endpoints = collectLineEndpoints([]);

      expect(endpoints).toEqual([]);
    });

    it("handles single line", () => {
      const lines = [{ from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }];

      const endpoints = collectLineEndpoints(lines);

      expect(endpoints).toEqual([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]);
    });

    it("deduplicates when from and to are the same point", () => {
      const lines = [{ from: { x: 50, y: 50 }, to: { x: 50, y: 50 } }];

      const endpoints = collectLineEndpoints(lines);

      expect(endpoints).toEqual([{ x: 50, y: 50 }]);
    });
  });

  describe("renderSnapIndicators", () => {
    const indicator: SnapIndicator = {
      lines: [
        { from: { x: 0, y: 100 }, to: { x: 200, y: 100 } },
        { from: { x: 100, y: 0 }, to: { x: 100, y: 200 } },
      ],
    };

    it("draws indicator lines", () => {
      renderSnapIndicators(rc, indicator, 5);

      expect(ctx.drawLine).toHaveBeenCalledWith(0, 100, 200, 100);
      expect(ctx.drawLine).toHaveBeenCalledWith(100, 0, 100, 200);
    });

    it("draws X markers at endpoints", () => {
      renderSnapIndicators(rc, indicator, 5);

      const drawLineCalls = (ctx.drawLine as ReturnType<typeof vi.fn>).mock.calls;

      expect(drawLineCalls.length).toBeGreaterThan(2);

      const markerCalls = drawLineCalls.slice(2);
      expect(markerCalls.length).toBe(8);
    });

    it("each X marker consists of two crossing lines", () => {
      const crossHalf = 5;
      renderSnapIndicators(rc, indicator, crossHalf);

      const drawLineCalls = (ctx.drawLine as ReturnType<typeof vi.fn>).mock.calls;

      expect(drawLineCalls).toContainEqual([0 - 5, 100 - 5, 0 + 5, 100 + 5]);
      expect(drawLineCalls).toContainEqual([0 - 5, 100 + 5, 0 + 5, 100 - 5]);
    });

    it("applies snap indicator style", () => {
      renderSnapIndicators(rc, indicator, 5);

      expect(ctx.setStyle).toHaveBeenCalledWith(
        expect.objectContaining({ strokeStyle: "#ff3b30" }),
      );
    });

    it("sets lineWidth through pxToUpm", () => {
      const pxToUpmSpy = vi.fn((px?: number) => (px ?? 1) * 3);
      rc.pxToUpm = pxToUpmSpy;

      renderSnapIndicators(rc, indicator, 5);

      expect(pxToUpmSpy).toHaveBeenCalled();
    });

    it("uses explicit markers when provided in indicator", () => {
      const indicatorWithMarkers: SnapIndicator = {
        lines: [{ from: { x: 0, y: 100 }, to: { x: 200, y: 100 } }],
        markers: [{ x: 50, y: 50 }],
      };

      renderSnapIndicators(rc, indicatorWithMarkers, 5);

      const drawLineCalls = (ctx.drawLine as ReturnType<typeof vi.fn>).mock.calls;

      expect(drawLineCalls).toContainEqual([50 - 5, 50 - 5, 50 + 5, 50 + 5]);
      expect(drawLineCalls).toContainEqual([50 - 5, 50 + 5, 50 + 5, 50 - 5]);

      const markerCalls = drawLineCalls.slice(1);
      expect(markerCalls.length).toBe(2);
    });

    it("uses collected endpoints when markers not provided", () => {
      const singleLineIndicator: SnapIndicator = {
        lines: [{ from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }],
      };

      renderSnapIndicators(rc, singleLineIndicator, 3);

      const drawLineCalls = (ctx.drawLine as ReturnType<typeof vi.fn>).mock.calls;

      expect(drawLineCalls[0]).toEqual([10, 20, 30, 40]);

      expect(drawLineCalls).toContainEqual([10 - 3, 20 - 3, 10 + 3, 20 + 3]);
      expect(drawLineCalls).toContainEqual([30 - 3, 40 - 3, 30 + 3, 40 + 3]);
    });
  });
});
