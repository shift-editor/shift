import { describe, expect, it, vi } from "vitest";
import { selectionBoundingRectContributor } from "./BoundingBoxRenderContributors";
import type { IRenderer } from "@/types/graphics";
import type { Rect2D } from "@shift/types";

function createRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "transparent",
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

describe("selectionBoundingRectContributor", () => {
  it("compensates dash pattern for renderer zoom normalization", () => {
    const renderer = createRenderer();
    const rect: Rect2D = {
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      left: 10,
      top: 20,
      right: 110,
      bottom: 80,
    };

    const editor = {
      isPreviewMode: () => false,
      shouldRenderEditableGlyph: () => true,
      getSelectionBoundingRect: () => rect,
      getDrawOffset: () => ({ x: 0, y: 0 }),
      getZoom: () => 2,
    };

    selectionBoundingRectContributor.render({
      editor: editor as never,
      draw: { renderer } as never,
      pxToUpm: (px = 1) => px / 2,
      applyStyle: (ctx) => {
        ctx.dashPattern = [6, 4];
      },
      projectGlyphLocalToScreen: (point) => point,
    });

    expect(renderer.dashPattern).toEqual([12, 8]);
    expect(renderer.strokeRect).toHaveBeenCalledWith(10, 20, 100, 60);
  });
});
