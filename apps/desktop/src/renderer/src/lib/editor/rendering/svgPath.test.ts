import { describe, it, expect, vi } from "vitest";
import { parseSvgPath, renderSvgPathToCanvas } from "./svgPath";
import type { IRenderer } from "@/types/graphics";

function createMockRenderer(): IRenderer {
  return {
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    cubicTo: vi.fn(),
    quadTo: vi.fn(),
    closePath: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    clear: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    drawLine: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillCircle: vi.fn(),
    strokeCircle: vi.fn(),
    set strokeStyle(_: string) {},
    set fillStyle(_: string) {},
    set lineWidth(_: number) {},
    set dashPattern(_: number[]) {},
    setStyle: vi.fn(),
  } as unknown as IRenderer;
}

describe("parseSvgPath", () => {
  it("should parse M command", () => {
    const cmds = parseSvgPath("M10 20");
    expect(cmds).toEqual([{ type: "M", args: [10, 20] }]);
  });

  it("should parse multiple commands", () => {
    const cmds = parseSvgPath("M0 0 L100 100 Z");
    expect(cmds).toHaveLength(3);
    expect(cmds[0].type).toBe("M");
    expect(cmds[1].type).toBe("L");
    expect(cmds[2].type).toBe("Z");
  });

  it("should parse C command with 6 args", () => {
    const cmds = parseSvgPath("C10 20 30 40 50 60");
    expect(cmds[0].args).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("should parse comma-separated args", () => {
    const cmds = parseSvgPath("M10,20 L30,40");
    expect(cmds[0].args).toEqual([10, 20]);
    expect(cmds[1].args).toEqual([30, 40]);
  });

  it("should handle empty path", () => {
    expect(parseSvgPath("")).toEqual([]);
  });
});

describe("renderSvgPathToCanvas", () => {
  it("should call moveTo for M command", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M10 20");
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
  });

  it("should call lineTo for L command", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M0 0 L100 200");
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 200);
  });

  it("should handle H and V commands", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M0 0 H100 V200");
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 200);
  });

  it("should call cubicTo for C command", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M0 0 C10 20 30 40 50 60");
    expect(ctx.cubicTo).toHaveBeenCalledWith(10, 20, 30, 40, 50, 60);
  });

  it("should call quadTo for Q command", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M0 0 Q50 50 100 0");
    expect(ctx.quadTo).toHaveBeenCalledWith(50, 50, 100, 0);
  });

  it("should call closePath for Z command", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M0 0 L100 0 L100 100 Z");
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it("should handle relative commands", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M10 20 l5 5");
    expect(ctx.lineTo).toHaveBeenCalledWith(15, 25);
  });

  it("should handle relative m after first M", () => {
    const ctx = createMockRenderer();
    renderSvgPathToCanvas(ctx, "M100 100 m10 10");
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(ctx.moveTo).toHaveBeenCalledWith(110, 110);
  });
});
