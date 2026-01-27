import { describe, it, expect, vi, beforeEach } from "vitest";

import { drawHandle, drawHandleLast, type HandleState, type HandleType } from "./index";
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
    quadTo: vi.fn(),
    cubicTo: vi.fn(),
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

describe("handles API", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("drawHandle", () => {
    const handleTypes: Exclude<HandleType, "last">[] = [
      "corner",
      "control",
      "smooth",
      "first",
      "direction",
    ];

    const handleStates: HandleState[] = ["idle", "hovered", "selected"];

    it.each(handleTypes)(
      "should dispatch to correct renderer for %s handle",
      (type) => {
        drawHandle(ctx, type, 100, 100, "idle");
        expect(ctx.setStyle).toHaveBeenCalled();
      },
    );

    it.each(handleStates)("should work for %s state", (state) => {
      drawHandle(ctx, "corner", 50, 50, state);
      expect(ctx.setStyle).toHaveBeenCalled();
    });

    it("should pass options to direction handle", () => {
      drawHandle(ctx, "direction", 100, 100, "idle", {
        segmentAngle: Math.PI / 4,
      });
      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
    });
  });

  describe("drawHandleLast", () => {
    it("should draw last handle with position data", () => {
      drawHandleLast(ctx, { x0: 100, y0: 100, x1: 200, y1: 200 }, "idle");

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.rotate).toHaveBeenCalled();
      expect(ctx.drawLine).toHaveBeenCalled();
    });
  });
});
