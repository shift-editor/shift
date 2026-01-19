import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  drawFirstHandle,
  drawCornerHandle,
  drawControlHandle,
  drawSmoothHandle,
  drawDirectionHandle,
  drawLastHandle,
} from "./renderers";
import type { IRenderer } from "@/types/graphics";
import type { HandleState } from "@/types/handle";

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
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
  };
}

describe("renderers", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("drawFirstHandle", () => {
    it("should set style and draw filled circle when selected", () => {
      drawFirstHandle(ctx, 10, 20, "selected");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.fillCircle).toHaveBeenCalled();
    });

    it("should set style and draw stroked circle when idle", () => {
      drawFirstHandle(ctx, 10, 20, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeCircle).toHaveBeenCalled();
    });

    it("should set style and draw stroked circle when hovered", () => {
      drawFirstHandle(ctx, 10, 20, "hovered");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeCircle).toHaveBeenCalled();
    });
  });

  describe("drawCornerHandle", () => {
    it("should set style and draw filled rect when selected", () => {
      drawCornerHandle(ctx, 100, 100, "selected");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled();
    });

    it("should set style and draw stroked rect when idle", () => {
      drawCornerHandle(ctx, 100, 100, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeRect).toHaveBeenCalled();
    });
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
    it("should draw inner circle and arc", () => {
      drawDirectionHandle(ctx, 100, 100, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.strokeCircle).toHaveBeenCalled();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.arcTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it("should draw filled circle when selected", () => {
      drawDirectionHandle(ctx, 100, 100, "selected");

      expect(ctx.fillCircle).toHaveBeenCalled();
    });

    it("should handle counter-clockwise option", () => {
      drawDirectionHandle(ctx, 100, 100, "idle", { isCounterClockWise: true });

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe("drawLastHandle", () => {
    it("should draw arrows along the direction", () => {
      drawLastHandle(ctx, { x0: 100, y0: 100, x1: 200, y1: 200 }, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
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
