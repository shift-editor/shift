import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrawAPI } from "./DrawAPI";
import type { IRenderer, ScreenConverter } from "@/types/graphics";

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

function createMockScreenConverter(scale = 2): ScreenConverter {
  return {
    toUpmDistance: vi.fn((px: number) => px / scale),
  };
}

describe("DrawAPI", () => {
  let renderer: IRenderer;
  let screen: ScreenConverter;
  let draw: DrawAPI;

  beforeEach(() => {
    renderer = createMockRenderer();
    screen = createMockScreenConverter();
    draw = new DrawAPI(renderer, screen);
  });

  describe("constructor", () => {
    it("should store renderer reference", () => {
      expect(draw.renderer).toBe(renderer);
    });
  });

  describe("line", () => {
    it("should draw a line between two points", () => {
      draw.line({ x: 0, y: 0 }, { x: 100, y: 100 });

      expect(renderer.save).toHaveBeenCalled();
      expect(renderer.drawLine).toHaveBeenCalledWith(0, 0, 100, 100);
      expect(renderer.restore).toHaveBeenCalled();
    });

    it("should convert stroke width from screen pixels to UPM", () => {
      draw.line({ x: 0, y: 0 }, { x: 100, y: 100 }, { strokeWidth: 2 });

      expect(screen.toUpmDistance).toHaveBeenCalledWith(2);
    });

    it("should apply stroke style", () => {
      draw.line({ x: 0, y: 0 }, { x: 100, y: 100 }, { strokeStyle: "#ff0000" });

      expect(renderer.strokeStyle).toBe("#ff0000");
    });
  });

  describe("rect", () => {
    it("should draw a rectangle between two corner points", () => {
      draw.rect({ x: 10, y: 20 }, { x: 110, y: 120 }, { strokeStyle: "#000" });

      expect(renderer.save).toHaveBeenCalled();
      expect(renderer.strokeRect).toHaveBeenCalledWith(10, 20, 100, 100);
      expect(renderer.restore).toHaveBeenCalled();
    });

    it("should normalize coordinates for reversed corners", () => {
      draw.rect({ x: 110, y: 120 }, { x: 10, y: 20 }, { strokeStyle: "#000" });

      expect(renderer.strokeRect).toHaveBeenCalledWith(10, 20, 100, 100);
    });

    it("should fill when fillStyle provided", () => {
      draw.rect({ x: 0, y: 0 }, { x: 50, y: 50 }, { fillStyle: "blue" });

      expect(renderer.fillRect).toHaveBeenCalled();
    });
  });

  describe("circle", () => {
    it("should draw a circle at center with radius converted from screen pixels", () => {
      draw.circle({ x: 50, y: 50 }, 10, { strokeStyle: "#000" });

      expect(screen.toUpmDistance).toHaveBeenCalledWith(10);
      expect(renderer.strokeCircle).toHaveBeenCalledWith(50, 50, 5);
    });

    it("should fill when fillStyle provided", () => {
      draw.circle({ x: 50, y: 50 }, 10, { fillStyle: "red" });

      expect(renderer.fillCircle).toHaveBeenCalled();
    });
  });

  describe("path", () => {
    it("should draw a path through multiple points", () => {
      draw.path(
        [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        false,
        { strokeStyle: "#000" },
      );

      expect(renderer.beginPath).toHaveBeenCalled();
      expect(renderer.moveTo).toHaveBeenCalledWith(0, 0);
      expect(renderer.lineTo).toHaveBeenCalledWith(50, 50);
      expect(renderer.lineTo).toHaveBeenCalledWith(100, 0);
      expect(renderer.stroke).toHaveBeenCalled();
    });

    it("should close path when closed=true", () => {
      draw.path(
        [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
        true,
        { strokeStyle: "#000" },
      );

      expect(renderer.closePath).toHaveBeenCalled();
    });

    it("should not draw if less than 2 points", () => {
      draw.path([{ x: 0, y: 0 }], false, { strokeStyle: "#000" });

      expect(renderer.beginPath).not.toHaveBeenCalled();
    });
  });

  describe("handle", () => {
    it("should draw corner handle as rectangle", () => {
      draw.handle({ x: 50, y: 50 }, "corner", "idle");

      expect(renderer.save).toHaveBeenCalled();
      expect(renderer.fillRect).toHaveBeenCalled();
      expect(renderer.strokeRect).toHaveBeenCalled();
      expect(renderer.restore).toHaveBeenCalled();
    });

    it("should draw control handle as circle", () => {
      draw.handle({ x: 50, y: 50 }, "control", "idle");

      expect(renderer.fillCircle).toHaveBeenCalled();
      expect(renderer.strokeCircle).toHaveBeenCalled();
    });

    it("should draw smooth handle as circle", () => {
      draw.handle({ x: 50, y: 50 }, "smooth", "idle");

      expect(renderer.fillCircle).toHaveBeenCalled();
      expect(renderer.strokeCircle).toHaveBeenCalled();
    });
  });

  describe("handleFirst", () => {
    it("should draw first handle with bar and triangle", () => {
      draw.handleFirst({ x: 50, y: 50 }, 0, "idle");

      expect(renderer.save).toHaveBeenCalled();
      expect(renderer.drawLine).toHaveBeenCalled();
      expect(renderer.beginPath).toHaveBeenCalled();
      expect(renderer.fill).toHaveBeenCalled();
      expect(renderer.stroke).toHaveBeenCalled();
      expect(renderer.restore).toHaveBeenCalled();
    });
  });

  describe("handleDirection", () => {
    it("should draw direction handle as triangle", () => {
      draw.handleDirection({ x: 50, y: 50 }, Math.PI / 4, "idle");

      expect(renderer.rotate).toHaveBeenCalled();
      expect(renderer.beginPath).toHaveBeenCalled();
      expect(renderer.fill).toHaveBeenCalled();
      expect(renderer.stroke).toHaveBeenCalled();
    });
  });

  describe("handleLast", () => {
    it("should draw last handle as bar perpendicular to direction", () => {
      draw.handleLast({ anchor: { x: 50, y: 50 }, prev: { x: 100, y: 50 } }, "idle");

      expect(renderer.rotate).toHaveBeenCalled();
      expect(renderer.drawLine).toHaveBeenCalled();
    });
  });

  describe("controlLine", () => {
    it("should draw line from anchor to control and then a control handle", () => {
      draw.controlLine({ x: 50, y: 50 }, { x: 100, y: 100 }, "idle");

      expect(renderer.drawLine).toHaveBeenCalledWith(50, 50, 100, 100);
      expect(renderer.fillCircle).toHaveBeenCalled();
      expect(renderer.strokeCircle).toHaveBeenCalled();
    });
  });

  describe("path building methods", () => {
    it("should delegate beginPath to renderer", () => {
      draw.beginPath();
      expect(renderer.beginPath).toHaveBeenCalled();
    });

    it("should delegate moveTo to renderer", () => {
      draw.moveTo({ x: 10, y: 20 });
      expect(renderer.moveTo).toHaveBeenCalledWith(10, 20);
    });

    it("should delegate lineTo to renderer", () => {
      draw.lineTo({ x: 30, y: 40 });
      expect(renderer.lineTo).toHaveBeenCalledWith(30, 40);
    });

    it("should delegate quadTo to renderer", () => {
      draw.quadTo({ x: 20, y: 30 }, { x: 40, y: 50 });
      expect(renderer.quadTo).toHaveBeenCalledWith(20, 30, 40, 50);
    });

    it("should delegate cubicTo to renderer", () => {
      draw.cubicTo({ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 });
      expect(renderer.cubicTo).toHaveBeenCalledWith(10, 20, 30, 40, 50, 60);
    });

    it("should delegate closePath to renderer", () => {
      draw.closePath();
      expect(renderer.closePath).toHaveBeenCalled();
    });
  });

  describe("fill and stroke", () => {
    it("should apply fill style and fill", () => {
      draw.fill({ fillStyle: "green" });

      expect(renderer.fillStyle).toBe("green");
      expect(renderer.fill).toHaveBeenCalled();
    });

    it("should apply stroke style and stroke with converted width", () => {
      draw.stroke({ strokeStyle: "red", strokeWidth: 4 });

      expect(renderer.strokeStyle).toBe("red");
      expect(screen.toUpmDistance).toHaveBeenCalledWith(4);
      expect(renderer.stroke).toHaveBeenCalled();
    });
  });

  describe("setStyle", () => {
    it("should apply stroke, fill and line width", () => {
      draw.setStyle({ strokeStyle: "#abc", fillStyle: "#def", lineWidth: 3 });

      expect(renderer.strokeStyle).toBe("#abc");
      expect(renderer.fillStyle).toBe("#def");
      expect(screen.toUpmDistance).toHaveBeenCalledWith(3);
    });
  });

  describe("svgPath", () => {
    it("should save/restore renderer state", () => {
      draw.svgPath("M0 0L100 100", 65, 50, 100);

      expect(renderer.save).toHaveBeenCalled();
      expect(renderer.restore).toHaveBeenCalled();
    });

    it("should translate to position", () => {
      draw.svgPath("M0 0L100 100", 65, 50, 100);

      expect(renderer.translate).toHaveBeenCalledWith(50, 100);
    });

    it("should call fillPath with a Path2D", () => {
      draw.svgPath("M0 0L100 100", 65, 0, 0);

      expect(renderer.fillPath).toHaveBeenCalledWith(expect.any(Path2D));
    });

    it("should apply fill style when provided", () => {
      draw.svgPath("M0 0L100 100", 65, 0, 0, { fillStyle: "#ff0000" });

      expect(renderer.fillStyle).toBe("#ff0000");
    });
  });
});
