import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  drawFirstHandle,
  drawCornerHandle,
  drawControlHandle,
  drawSmoothHandle,
  drawDirectionHandle,
  drawLastHandle,
  type HandleState,
} from "./renderers";
import type { IRenderer } from "@/types/graphics";

function createMockRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    flush: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
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
    cubicTo: vi.fn(),
    quadTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

describe("renderers", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("drawFirstHandle", () => {
    it("should draw horizontal line and triangle", () => {
      drawFirstHandle(ctx, 10, 20, "idle", { segmentAngle: 0 });

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
      expect(ctx.drawLine).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("should use segment angle for orientation", () => {
      const angle = Math.PI / 4;
      drawFirstHandle(ctx, 10, 20, "idle", { segmentAngle: angle });

      expect(ctx.rotate).toHaveBeenCalled();
    });
  });

  describe("drawCornerHandle", () => {
    it("should draw both filled and stroked rect", () => {
      drawCornerHandle(ctx, 100, 100, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
    });

    it.each<HandleState>(["idle", "hovered", "selected"])(
      "should work for state %s",
      (state) => {
        drawCornerHandle(ctx, 100, 100, state);
        expect(ctx.setStyle).toHaveBeenCalled();
        expect(ctx.fillRect).toHaveBeenCalled();
        expect(ctx.strokeRect).toHaveBeenCalled();
      },
    );
  });

  describe("drawControlHandle", () => {
    it("should draw both stroked and filled circle", () => {
      drawControlHandle(ctx, 50, 50, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeCircle).toHaveBeenCalled();
      expect(ctx.fillCircle).toHaveBeenCalled();
    });

    it.each<HandleState>(["idle", "hovered", "selected"])(
      "should work for state %s",
      (state) => {
        drawControlHandle(ctx, 50, 50, state);
        expect(ctx.setStyle).toHaveBeenCalled();
      },
    );
  });

  describe("drawSmoothHandle", () => {
    it("should draw both stroked and filled circle", () => {
      drawSmoothHandle(ctx, 75, 75, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeCircle).toHaveBeenCalled();
      expect(ctx.fillCircle).toHaveBeenCalled();
    });
  });

  describe("drawDirectionHandle", () => {
    it("should draw triangle pointing in segment direction", () => {
      drawDirectionHandle(ctx, 100, 100, "idle", { segmentAngle: 0 });

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("should use segment angle for orientation", () => {
      const angle = Math.PI / 2;
      drawDirectionHandle(ctx, 100, 100, "idle", { segmentAngle: angle });

      expect(ctx.rotate).toHaveBeenCalled();
    });
  });

  describe("drawLastHandle", () => {
    it("should draw horizontal line perpendicular to segment direction", () => {
      drawLastHandle(ctx, { x0: 100, y0: 100, x1: 200, y1: 200 }, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
      expect(ctx.drawLine).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it.each<HandleState>(["idle", "hovered", "selected"])(
      "should work for state %s",
      (state) => {
        drawLastHandle(ctx, { x0: 0, y0: 0, x1: 100, y1: 100 }, state);
        expect(ctx.setStyle).toHaveBeenCalled();
      },
    );
  });
});
