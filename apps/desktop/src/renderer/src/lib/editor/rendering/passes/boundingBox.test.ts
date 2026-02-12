import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderBoundingRect, renderBoundingBoxHandles } from "./boundingBox";
import type { IRenderer } from "@/types/graphics";
import type { Rect2D } from "@shift/types";
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
  return {
    ctx,
    lineWidthUpm: (px?: number) => px ?? 1,
  };
}

const testRect: Rect2D = {
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  left: 10,
  top: 20,
  right: 110,
  bottom: 100,
};

describe("boundingBox", () => {
  let ctx: IRenderer;
  let rc: RenderContext;

  beforeEach(() => {
    ctx = createMockRenderer();
    rc = createRenderContext(ctx);
  });

  describe("renderBoundingRect", () => {
    it("calls strokeRect with correct args", () => {
      renderBoundingRect(rc, testRect);

      expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 100, 80);
    });

    it("calls strokeRect exactly once", () => {
      renderBoundingRect(rc, testRect);

      expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    });

    it("does not call fillRect", () => {
      renderBoundingRect(rc, testRect);

      expect(ctx.fillRect).not.toHaveBeenCalled();
    });
  });

  describe("renderBoundingBoxHandles", () => {
    it("draws circles for all 8 handles (4 corners + 4 midpoints)", () => {
      renderBoundingBoxHandles(ctx, { rect: testRect });

      expect(ctx.strokeCircle).toHaveBeenCalledTimes(8);
      expect(ctx.fillCircle).toHaveBeenCalledTimes(8);
    });

    it("calls setStyle for handle styling", () => {
      renderBoundingBoxHandles(ctx, { rect: testRect });

      expect(ctx.setStyle).toHaveBeenCalled();
    });

    it("hovered corner handle gets larger radius", () => {
      const radiusCalls: number[] = [];
      ctx.strokeCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));
      ctx.fillCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));

      renderBoundingBoxHandles(ctx, {
        rect: testRect,
        hoveredHandle: { type: "resize", edge: "top-left" },
      });

      const uniqueRadii = [...new Set(radiusCalls)];
      expect(uniqueRadii.length).toBe(2);

      const maxRadius = Math.max(...uniqueRadii);
      const minRadius = Math.min(...uniqueRadii);
      expect(maxRadius).toBe(minRadius + 1);
    });

    it("hovered midpoint handle gets larger radius", () => {
      const radiusCalls: number[] = [];
      ctx.strokeCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));
      ctx.fillCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));

      renderBoundingBoxHandles(ctx, {
        rect: testRect,
        hoveredHandle: { type: "resize", edge: "top" },
      });

      const uniqueRadii = [...new Set(radiusCalls)];
      expect(uniqueRadii.length).toBe(2);

      const maxRadius = Math.max(...uniqueRadii);
      const minRadius = Math.min(...uniqueRadii);
      expect(maxRadius).toBe(minRadius + 1);
    });

    it("without hovered handle all handles have same radius", () => {
      const radiusCalls: number[] = [];
      ctx.strokeCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));

      renderBoundingBoxHandles(ctx, { rect: testRect });

      const uniqueRadii = [...new Set(radiusCalls)];
      expect(uniqueRadii.length).toBe(1);
    });

    it("draws both stroke and fill for each handle", () => {
      renderBoundingBoxHandles(ctx, { rect: testRect });

      expect(ctx.strokeCircle).toHaveBeenCalledTimes(8);
      expect(ctx.fillCircle).toHaveBeenCalledTimes(8);
    });

    it("rotation hit result does not enlarge any handle", () => {
      const radiusCalls: number[] = [];
      ctx.strokeCircle = vi.fn((_x, _y, r) => radiusCalls.push(r));

      renderBoundingBoxHandles(ctx, {
        rect: testRect,
        hoveredHandle: { type: "rotate", corner: "top-left" },
      });

      const uniqueRadii = [...new Set(radiusCalls)];
      expect(uniqueRadii.length).toBe(1);
    });
  });
});
