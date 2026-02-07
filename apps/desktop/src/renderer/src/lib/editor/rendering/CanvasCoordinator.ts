import type { IGraphicContext, IRenderer, HandleState } from "@/types/graphics";
import type { Glyph, Rect2D, Point2D, PointId, FontMetrics } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { BoundingBoxHitResult } from "@/types/boundingBox";
import type { SnapIndicator } from "../snapping/types";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";

import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SNAP_INDICATOR_CROSS_SIZE_PX,
} from "@/lib/styles/style";

import { FrameHandler } from "./FrameHandler";
import { FpsMonitor } from "./FpsMonitor";
import { SCREEN_LINE_WIDTH } from "./constants";
import { DrawAPI as DrawAPIClass } from "@/lib/tools/core/DrawAPI";

import {
  renderGuides,
  getGuides,
  renderGlyphOutline,
  renderGlyphFilled,
  renderSegmentHighlights,
  renderHandles,
  renderBoundingRect,
  renderBoundingBoxHandles,
  renderSnapIndicators,
} from "./passes";

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
  centre: Point2D;
  upmScale: number;
  logicalHeight: number;
  padding: number;
  descender: number;
}

export interface CanvasCoordinatorContext {
  getGlyph(): Glyph | null;
  getFontMetrics(): FontMetrics;
  isPreviewMode(): boolean;
  isHandlesVisible(): boolean;
  getSelectionBoundingRect(): Rect2D | null;
  getHoveredSegmentId(): SegmentId | null;
  isSegmentSelected(segmentId: SegmentId): boolean;
  getHandleState(pointId: PointId): HandleState;
  getHoveredBoundingBoxHandle(): BoundingBoxHitResult | null;
  getSnapIndicator(): SnapIndicator | null;
  getViewportTransform(): ViewportTransform;
  screenToUpmDistance(px: number): number;
  projectUpmToScreen(x: number, y: number): Point2D;
  renderTool(draw: DrawAPI): void;
  renderToolBelowHandles(draw: DrawAPI): void;
}

export class CanvasCoordinator {
  #staticContext: IGraphicContext | null = null;
  #overlayContext: IGraphicContext | null = null;
  #interactiveContext: IGraphicContext | null = null;
  #staticDraw: DrawAPIClass | null = null;
  #interactiveDraw: DrawAPIClass | null = null;
  #staticFrameHandler: FrameHandler;
  #overlayFrameHandler: FrameHandler;
  #interactiveFrameHandler: FrameHandler;
  #fpsMonitor: FpsMonitor;
  #ctx: CanvasCoordinatorContext;

  constructor(ctx: CanvasCoordinatorContext) {
    this.#ctx = ctx;
    this.#staticFrameHandler = new FrameHandler();
    this.#overlayFrameHandler = new FrameHandler();
    this.#interactiveFrameHandler = new FrameHandler();
    this.#fpsMonitor = new FpsMonitor();
  }

  get fpsMonitor(): FpsMonitor {
    return this.#fpsMonitor;
  }

  #createScreenConverter() {
    return { toUpmDistance: (px: number) => this.#ctx.screenToUpmDistance(px) };
  }

  setStaticContext(context: IGraphicContext): void {
    this.#staticContext = context;
    this.#staticDraw = new DrawAPIClass(context.getContext(), this.#createScreenConverter());
  }

  setOverlayContext(context: IGraphicContext): void {
    this.#overlayContext = context;
  }

  setInteractiveContext(context: IGraphicContext): void {
    this.#interactiveContext = context;
    this.#interactiveDraw = new DrawAPIClass(context.getContext(), this.#createScreenConverter());
  }

  requestStaticRedraw(): void {
    this.#staticFrameHandler.requestUpdate(() => this.#drawStatic());
  }

  requestOverlayRedraw(): void {
    this.#overlayFrameHandler.requestUpdate(() => this.#drawOverlay());
  }

  requestInteractiveRedraw(): void {
    this.#interactiveFrameHandler.requestUpdate(() => this.#drawInteractive());
  }

  requestRedraw(): void {
    this.requestStaticRedraw();
    this.requestOverlayRedraw();
    this.requestInteractiveRedraw();
  }

  requestImmediateRedraw(): void {
    this.#drawStatic();
    this.#drawOverlay();
    this.#drawInteractive();
  }

  cancelRedraw(): void {
    this.#staticFrameHandler.cancelUpdate();
    this.#overlayFrameHandler.cancelUpdate();
    this.#interactiveFrameHandler.cancelUpdate();
  }

  #applyTransforms(ctx: IRenderer): void {
    const vt = this.#ctx.getViewportTransform();

    ctx.transform(
      vt.zoom,
      0,
      0,
      vt.zoom,
      vt.panX + vt.centre.x * (1 - vt.zoom),
      vt.panY + vt.centre.y * (1 - vt.zoom),
    );

    const baselineY = vt.logicalHeight - vt.padding - vt.descender * vt.upmScale;
    ctx.transform(vt.upmScale, 0, 0, -vt.upmScale, vt.padding, baselineY);
  }

  #lineWidthUpm(screenPixels = SCREEN_LINE_WIDTH): number {
    return this.#ctx.screenToUpmDistance(screenPixels);
  }

  #drawInteractive(): void {
    if (!this.#interactiveContext || !this.#interactiveDraw) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#applyTransforms(ctx);
    this.#ctx.renderTool(this.#interactiveDraw);

    ctx.restore();
  }

  #drawOverlay(): void {
    if (!this.#overlayContext) return;
    const ctx = this.#overlayContext.getContext();
    ctx.clear();

    const indicator = this.#ctx.getSnapIndicator();
    if (!indicator) return;

    ctx.save();
    this.#applyTransforms(ctx);

    const rc = { ctx, lineWidthUpm: (px?: number) => this.#lineWidthUpm(px) };
    const crossHalf = this.#ctx.screenToUpmDistance(SNAP_INDICATOR_CROSS_SIZE_PX);
    renderSnapIndicators(rc, indicator, crossHalf);

    ctx.restore();
  }

  #drawStatic(): void {
    if (!this.#staticContext || !this.#staticDraw) return;
    const ctx = this.#staticContext.getContext();
    const draw = this.#staticDraw;

    const glyph = this.#ctx.getGlyph();
    const previewMode = this.#ctx.isPreviewMode();
    const handlesVisible = this.#ctx.isHandlesVisible();

    const rc = { ctx, lineWidthUpm: (px?: number) => this.#lineWidthUpm(px) };

    ctx.clear();
    ctx.save();

    this.#applyTransforms(ctx);

    if (glyph) {
      const guides = getGuides(glyph, this.#ctx.getFontMetrics());
      ctx.setStyle(GUIDE_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(GUIDE_STYLES.lineWidth);

      if (!previewMode) {
        renderGuides(ctx, guides);
      }

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(DEFAULT_STYLES.lineWidth);
      const hasClosed = renderGlyphOutline(ctx, glyph);

      if (hasClosed && previewMode) {
        renderGlyphFilled(ctx, glyph);
      }
    }

    let bbRect: Rect2D | null = null;
    const shouldDrawBoundingRect = !previewMode;
    if (shouldDrawBoundingRect) {
      bbRect = this.#ctx.getSelectionBoundingRect();
      if (bbRect) {
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.lineWidth = this.#lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
        renderBoundingRect(rc, bbRect);
      }
    }

    if (!previewMode && glyph) {
      renderSegmentHighlights(rc, glyph, this.#ctx.getHoveredSegmentId(), (id) =>
        this.#ctx.isSegmentSelected(id),
      );
    }

    if (!previewMode) {
      this.#ctx.renderToolBelowHandles(draw);
    }

    if (!previewMode && handlesVisible && glyph) {
      renderHandles(draw, glyph, (id) => this.#ctx.getHandleState(id));
    }

    ctx.restore();
    ctx.save();

    if (shouldDrawBoundingRect && bbRect && handlesVisible) {
      this.#drawBoundingBoxHandles(ctx, bbRect);
    }

    ctx.restore();
  }

  #drawBoundingBoxHandles(
    ctx: IRenderer,
    bbRect: { x: number; y: number; width: number; height: number },
  ): void {
    const topLeft = this.#ctx.projectUpmToScreen(bbRect.x, bbRect.y + bbRect.height);
    const bottomRight = this.#ctx.projectUpmToScreen(bbRect.x + bbRect.width, bbRect.y);

    const screenRect = {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };

    const hoveredHandle = this.#ctx.getHoveredBoundingBoxHandle();
    renderBoundingBoxHandles(ctx, {
      rect: screenRect,
      hoveredHandle: hoveredHandle ?? undefined,
    });
  }

  destroy(): void {
    this.#staticContext?.destroy();
    this.#overlayContext?.destroy();
    this.#interactiveContext?.destroy();
  }
}
