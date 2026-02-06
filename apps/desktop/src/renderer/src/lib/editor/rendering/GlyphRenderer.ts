import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SNAP_INDICATOR_CROSS_SIZE_PX,
  SNAP_INDICATOR_STYLE,
  SEGMENT_HOVER_STYLE,
  SEGMENT_SELECTED_STYLE,
} from "@/lib/styles/style";
import type { IGraphicContext, IRenderer } from "@/types/graphics";
import type { Glyph, Rect2D } from "@shift/types";

import { FrameHandler } from "./FrameHandler";
import { FpsMonitor } from "./FpsMonitor";
import { drawBoundingBoxHandles } from "./handles";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { renderGlyph, renderGuides, buildContourPath, type Guides } from "./render";
import { Segment } from "@/lib/geo/Segment";
import { SCREEN_LINE_WIDTH } from "./constants";
import type { Editor } from "../Editor";
import { DrawAPI } from "@/lib/tools/core/DrawAPI";

export class GlyphRenderer {
  #staticContext: IGraphicContext | null = null;
  #overlayContext: IGraphicContext | null = null;
  #interactiveContext: IGraphicContext | null = null;
  #staticDraw: DrawAPI | null = null;
  #interactiveDraw: DrawAPI | null = null;
  #staticFrameHandler: FrameHandler;
  #overlayFrameHandler: FrameHandler;
  #interactiveFrameHandler: FrameHandler;
  #fpsMonitor: FpsMonitor;
  #editor: Editor;
  #renderTool: (draw: DrawAPI) => void;
  #renderToolBelowHandles: ((draw: DrawAPI) => void) | null;

  constructor(
    editor: Editor,
    renderTool: (draw: DrawAPI) => void,
    renderToolBelowHandles?: (draw: DrawAPI) => void,
  ) {
    this.#editor = editor;
    this.#renderTool = renderTool;
    this.#renderToolBelowHandles = renderToolBelowHandles ?? null;
    this.#staticFrameHandler = new FrameHandler();
    this.#overlayFrameHandler = new FrameHandler();
    this.#interactiveFrameHandler = new FrameHandler();
    this.#fpsMonitor = new FpsMonitor();
  }

  get fpsMonitor(): FpsMonitor {
    return this.#fpsMonitor;
  }

  #createScreenConverter() {
    const viewport = this.#editor.viewportManager;
    return { toUpmDistance: (px: number) => viewport.screenToUpmDistance(px) };
  }

  setStaticContext(context: IGraphicContext): void {
    this.#staticContext = context;
    this.#staticDraw = new DrawAPI(context.getContext(), this.#createScreenConverter());
  }

  setOverlayContext(context: IGraphicContext): void {
    this.#overlayContext = context;
  }

  setInteractiveContext(context: IGraphicContext): void {
    this.#interactiveContext = context;
    this.#interactiveDraw = new DrawAPI(context.getContext(), this.#createScreenConverter());
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

  #prepareCanvas(ctx: IRenderer): void {
    this.#applyUserTransforms(ctx);
    this.#applyUpmTransforms(ctx);
  }

  #applyUserTransforms(ctx: IRenderer): void {
    const viewport = this.#editor.viewportManager;
    const center = viewport.centre;
    const zoom = this.#editor.getZoom();
    const { panX, panY } = viewport;

    ctx.transform(zoom, 0, 0, zoom, panX + center.x * (1 - zoom), panY + center.y * (1 - zoom));
  }

  #applyUpmTransforms(ctx: IRenderer): void {
    const viewport = this.#editor.viewportManager;
    const scale = viewport.upmScale;
    const baselineY = viewport.logicalHeight - viewport.padding - viewport.descender * scale;
    ctx.transform(scale, 0, 0, -scale, viewport.padding, baselineY);
  }

  #lineWidthUpm(screenPixels = SCREEN_LINE_WIDTH): number {
    return this.#editor.viewportManager.screenToUpmDistance(screenPixels);
  }

  #drawInteractive(): void {
    if (!this.#interactiveContext || !this.#interactiveDraw) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    this.#renderTool(this.#interactiveDraw);

    ctx.restore();
  }

  #drawOverlay(): void {
    if (!this.#overlayContext) return;
    const ctx = this.#overlayContext.getContext();
    ctx.clear();
    const indicator = this.#editor.getSnapIndicator();
    if (!indicator) return;

    ctx.save();
    this.#prepareCanvas(ctx);

    ctx.strokeStyle = SNAP_INDICATOR_STYLE.strokeStyle;
    ctx.lineWidth = this.#lineWidthUpm(SNAP_INDICATOR_STYLE.lineWidth);
    for (const line of indicator.lines) {
      ctx.drawLine(line.from.x, line.from.y, line.to.x, line.to.y);
    }

    const half = this.#editor.screenToUpmDistance(SNAP_INDICATOR_CROSS_SIZE_PX);
    const markers = indicator.markers ?? this.#collectLineEndpoints(indicator.lines);
    for (const marker of markers) {
      this.#drawX(ctx, marker.x, marker.y, half);
    }

    ctx.restore();
  }

  #collectLineEndpoints(
    lines: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>,
  ): Array<{
    x: number;
    y: number;
  }> {
    const markers: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const endpoints = [line.from, line.to];
      for (const endpoint of endpoints) {
        const key = `${endpoint.x}:${endpoint.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        markers.push(endpoint);
      }
    }
    return markers;
  }

  #drawX(ctx: IRenderer, x: number, y: number, half: number): void {
    ctx.drawLine(x - half, y - half, x + half, y + half);
    ctx.drawLine(x - half, y + half, x + half, y - half);
  }

  #drawStatic(): void {
    if (!this.#staticContext || !this.#staticDraw) return;
    const ctx = this.#staticContext.getContext();
    const draw = this.#staticDraw;

    const glyph = this.#editor.getGlyph();
    const previewMode = this.#editor.isPreviewMode();
    const handlesVisible = this.#editor.isHandlesVisible();

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    if (glyph) {
      const guides = this.#getGuides(glyph);
      ctx.setStyle(GUIDE_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(GUIDE_STYLES.lineWidth);

      if (!previewMode) {
        renderGuides(ctx, guides);
      }

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(DEFAULT_STYLES.lineWidth);
      const hasClosed = renderGlyph(ctx, glyph);

      if (hasClosed && previewMode) {
        ctx.fillStyle = "black";
        ctx.beginPath();
        for (const contour of glyph.contours) {
          buildContourPath(ctx, contour);
        }
        ctx.fill();
      }
    }

    let bbRect: Rect2D | null = null;
    const shouldDrawBoundingRect = !previewMode;
    if (shouldDrawBoundingRect) {
      bbRect = this.#editor.getSelectionBoundingRect();
      if (bbRect) {
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.lineWidth = this.#lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
        ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
      }
    }

    if (!previewMode && glyph) {
      this.#drawSegmentHighlights(ctx, glyph);
    }

    if (!previewMode) {
      this.#renderToolBelowHandles?.(draw);
    }

    if (!previewMode && handlesVisible && glyph) {
      this.#drawHandlesFromSnapshot(draw, glyph);
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
    const viewport = this.#editor.viewportManager;

    const topLeft = viewport.projectUpmToScreen(bbRect.x, bbRect.y + bbRect.height);
    const bottomRight = viewport.projectUpmToScreen(bbRect.x + bbRect.width, bbRect.y);

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

    const hoveredHandle = this.#editor.getHoveredBoundingBoxHandle();
    drawBoundingBoxHandles(ctx, {
      rect: screenRect,
      hoveredHandle: hoveredHandle ?? undefined,
    });
  }

  #getGuides(glyph: Glyph): Guides {
    const metrics = this.#editor.getFontMetrics();
    return {
      ascender: { y: metrics.ascender },
      capHeight: { y: metrics.capHeight ?? 0 },
      xHeight: { y: metrics.xHeight ?? 0 },
      baseline: { y: 0 },
      descender: { y: metrics.descender },
      xAdvance: glyph.xAdvance,
    };
  }

  #drawSegmentHighlights(ctx: IRenderer, glyph: Glyph): void {
    const hoveredSegment = this.#editor.getHoveredSegment();
    const selectedSegments = this.#editor.getSelectedSegments();

    if (!hoveredSegment && selectedSegments.length === 0) return;

    for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
      const segmentId = Segment.id(segment);
      const isHovered = hoveredSegment?.segmentId === segmentId;
      const isSelected = this.#editor.isSegmentSelected(segmentId);

      if (!isHovered && !isSelected) continue;

      const style = isSelected ? SEGMENT_SELECTED_STYLE : SEGMENT_HOVER_STYLE;
      ctx.setStyle(style);
      ctx.lineWidth = this.#lineWidthUpm(style.lineWidth);

      this.#drawSegmentCurve(ctx, segment);
    }
  }

  #drawSegmentCurve(ctx: IRenderer, segment: ReturnType<typeof Segment.parse>[number]): void {
    const curve = Segment.toCurve(segment);
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);

    switch (curve.type) {
      case "line":
        ctx.lineTo(curve.p1.x, curve.p1.y);
        break;
      case "quadratic":
        ctx.quadTo(curve.c.x, curve.c.y, curve.p1.x, curve.p1.y);
        break;
      case "cubic":
        ctx.cubicTo(curve.c0.x, curve.c0.y, curve.c1.x, curve.c1.y, curve.p1.x, curve.p1.y);
        break;
    }

    ctx.stroke();
  }

  #drawHandlesFromSnapshot(draw: DrawAPI, glyph: Glyph): void {
    draw.setStyle(DEFAULT_STYLES);

    for (const contour of glyph.contours) {
      for (const { current, prev, next } of Contours.withNeighbors(contour)) {
        if (current.pointType !== "offCurve") continue;

        const anchor = next?.pointType === "offCurve" ? prev : next;
        if (!anchor || anchor.pointType === "offCurve") continue;

        draw.line(
          { x: anchor.x, y: anchor.y },
          { x: current.x, y: current.y },
          {
            strokeStyle: DEFAULT_STYLES.strokeStyle,
            strokeWidth: DEFAULT_STYLES.lineWidth,
          },
        );
      }
    }

    for (const contour of glyph.contours) {
      const numPoints = contour.points.length;
      if (numPoints === 0) continue;

      for (const { current, prev, next, isFirst, isLast } of Contours.withNeighbors(contour)) {
        const pos = { x: current.x, y: current.y };
        const handleState = this.#editor.getHandleState(current.id);

        if (numPoints === 1) {
          draw.handle(pos, "corner", handleState);
          continue;
        }

        if (isFirst) {
          const segmentAngle = Vec2.angleTo(current, next!);

          if (contour.closed) {
            draw.handleDirection(pos, segmentAngle, handleState);
          } else {
            draw.handleFirst(pos, segmentAngle, handleState);
          }
          continue;
        }

        if (isLast && !contour.closed) {
          draw.handleLast({ anchor: pos, prev: { x: prev!.x, y: prev!.y } }, handleState);
          continue;
        }

        if (current.pointType === "onCurve") {
          if (current.smooth) {
            draw.handle(pos, "smooth", handleState);
          } else {
            draw.handle(pos, "corner", handleState);
          }
        } else {
          draw.handle(pos, "control", handleState);
        }
      }
    }
  }

  destroy(): void {
    this.#staticContext?.destroy();
    this.#overlayContext?.destroy();
    this.#interactiveContext?.destroy();
  }
}
