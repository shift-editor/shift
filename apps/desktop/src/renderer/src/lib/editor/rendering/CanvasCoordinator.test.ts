import { describe, it, expect, vi } from "vitest";
import { signal } from "../../reactive/signal";
import type { IGraphicContext, IRenderer } from "../../../types/graphics";
import type { Point2D } from "@shift/types";
import type { Font } from "../Font";
import { CanvasCoordinator, type CanvasCoordinatorContext } from "./CanvasCoordinator";

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

function createGraphicContext(renderer: IRenderer): IGraphicContext {
  return {
    resizeCanvas: vi.fn(),
    getContext: () => renderer,
    destroy: vi.fn(),
  };
}

function createContext(
  drawOffset: Point2D,
  projectSceneToScreen: (x: number, y: number) => Point2D,
  renderToolContributors: CanvasCoordinatorContext["renderToolContributors"] = vi.fn(),
): CanvasCoordinatorContext {
  const font: Font = {
    getMetrics: () => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: null,
      underlinePosition: null,
      underlineThickness: null,
    }),
    getMetadata: () => ({
      familyName: "Test",
      styleName: "Regular",
      postscriptName: "Test-Regular",
    }),
    getSvgPath: () => null,
    getAdvance: () => null,
    getBbox: () => null,
  };

  return {
    getDrawOffset: () => drawOffset,
    setDrawOffset: vi.fn(),
    glyph: signal(null),
    font,
    isPreviewMode: () => false,
    isHandlesVisible: () => true,
    getHoveredSegmentId: () => null,
    isSegmentSelected: () => false,
    getHandleState: () => "idle",
    getAnchorHandleState: () => "idle",
    getSnapIndicator: () => null,
    getViewportTransform: () => ({
      zoom: 1,
      panX: 0,
      panY: 0,
      centre: { x: 0, y: 0 },
      upmScale: 1,
      logicalHeight: 1000,
      padding: 0,
      descender: 0,
    }),
    screenToUpmDistance: (px) => px,
    projectSceneToScreen,
    getVisualGlyphAdvance: (glyph) => glyph.xAdvance,
    getDebugOverlays: () => ({
      tightBounds: false,
      hitRadii: false,
      segmentBounds: false,
      glyphBbox: false,
    }),
    renderTool: vi.fn(),
    renderToolBelowHandles: vi.fn(),
    renderToolContributors,
    shouldRenderEditableGlyph: () => true,
  };
}

describe("CanvasCoordinator", () => {
  it("applies drawOffset when projecting contributor screen points", () => {
    const renderer = createMockRenderer();
    const projectSceneToScreen = vi.fn((x: number, y: number) => ({ x, y }));
    const renderToolContributors = vi.fn((layer, context) => {
      if (layer !== "static-screen-after-handles") return;
      context.projectGlyphLocalToScreen({ x: 10, y: 60 });
      context.projectGlyphLocalToScreen({ x: 110, y: 20 });
    });
    const context = createContext({ x: 600, y: 25 }, projectSceneToScreen, renderToolContributors);
    const coordinator = new CanvasCoordinator(context);
    coordinator.setStaticContext(createGraphicContext(renderer));

    coordinator.requestImmediateRedraw();

    expect(projectSceneToScreen).toHaveBeenCalledTimes(2);
    expect(projectSceneToScreen).toHaveBeenNthCalledWith(1, 610, 85);
    expect(projectSceneToScreen).toHaveBeenNthCalledWith(2, 710, 45);
  });

  it("uses raw contributor points when drawOffset is zero", () => {
    const renderer = createMockRenderer();
    const projectSceneToScreen = vi.fn((x: number, y: number) => ({ x, y }));
    const renderToolContributors = vi.fn((layer, context) => {
      if (layer !== "static-screen-after-handles") return;
      context.projectGlyphLocalToScreen({ x: 10, y: 60 });
      context.projectGlyphLocalToScreen({ x: 110, y: 20 });
    });
    const context = createContext({ x: 0, y: 0 }, projectSceneToScreen, renderToolContributors);
    const coordinator = new CanvasCoordinator(context);
    coordinator.setStaticContext(createGraphicContext(renderer));

    coordinator.requestImmediateRedraw();

    expect(projectSceneToScreen).toHaveBeenCalledTimes(2);
    expect(projectSceneToScreen).toHaveBeenNthCalledWith(1, 10, 60);
    expect(projectSceneToScreen).toHaveBeenNthCalledWith(2, 110, 20);
  });

  it("does not project points when contributor does not request projection", () => {
    const renderer = createMockRenderer();
    const projectSceneToScreen = vi.fn((x: number, y: number) => ({ x, y }));
    const renderToolContributors = vi.fn();
    const context = createContext({ x: 350, y: 40 }, projectSceneToScreen, renderToolContributors);
    const coordinator = new CanvasCoordinator(context);
    coordinator.setStaticContext(createGraphicContext(renderer));

    coordinator.requestImmediateRedraw();

    expect(projectSceneToScreen).not.toHaveBeenCalled();
  });
});
