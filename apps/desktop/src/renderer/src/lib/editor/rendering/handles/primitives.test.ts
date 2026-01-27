import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  drawFilledCircle,
  drawStrokedCircle,
  drawFilledRect,
  drawStrokedRect,
  drawArrowHead,
  drawDirectionArrow,
} from "./primitives";
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
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
  };
}

describe("primitives", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("drawFilledCircle", () => {
    it("should call fillCircle with correct parameters", () => {
      drawFilledCircle(ctx, 10, 20, 5);
      expect(ctx.fillCircle).toHaveBeenCalledWith(10, 20, 5);
    });
  });

  describe("drawStrokedCircle", () => {
    it("should call strokeCircle with correct parameters", () => {
      drawStrokedCircle(ctx, 15, 25, 8);
      expect(ctx.strokeCircle).toHaveBeenCalledWith(15, 25, 8);
    });
  });

  describe("drawFilledRect", () => {
    it("should call fillRect centered on the given position", () => {
      drawFilledRect(ctx, 100, 100, 10);
      expect(ctx.fillRect).toHaveBeenCalledWith(95, 95, 10, 10);
    });
  });

  describe("drawStrokedRect", () => {
    it("should call strokeRect centered on the given position", () => {
      drawStrokedRect(ctx, 50, 50, 20);
      expect(ctx.strokeRect).toHaveBeenCalledWith(40, 40, 20, 20);
    });
  });

  describe("drawArrowHead", () => {
    it("should draw arrow head with beginPath, moveTo, lineTo, and stroke", () => {
      drawArrowHead(ctx, 100, 100, 0, 8);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it("should call moveTo twice for two arrow lines", () => {
      drawArrowHead(ctx, 100, 100, Math.PI / 2, 10);

      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    });
  });

  describe("drawDirectionArrow", () => {
    it("should draw upward arrow when direction is up", () => {
      drawDirectionArrow(ctx, 50, 50, "up", 8);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it("should draw downward arrow when direction is down", () => {
      drawDirectionArrow(ctx, 50, 50, "down", 8);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });
});
