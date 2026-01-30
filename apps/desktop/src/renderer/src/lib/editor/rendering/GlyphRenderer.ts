import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SEGMENT_HOVER_STYLE,
  SEGMENT_SELECTED_STYLE,
} from "@/lib/styles/style";
import type { IGraphicContext, IRenderer } from "@/types/graphics";
import type { GlyphSnapshot, ContourSnapshot, PointSnapshot, Glyph } from "@shift/types";
import { asPointId } from "@shift/types";

import { FrameHandler } from "./FrameHandler";
import { drawHandle, drawHandleLast, drawBoundingBoxHandles } from "./handles";
import { Polygon } from "@shift/geo";
import { renderGlyph, renderGuides, buildContourPath, type Guides } from "./render";
import { Segment } from "@/lib/geo/Segment";
import { SCREEN_LINE_WIDTH } from "./constants";
import type { Editor } from "../Editor";

export interface FontMetrics {
  ascender: number;
  capHeight: number;
  xHeight: number;
  descender: number;
}

export class GlyphRenderer {
  #staticContext: IGraphicContext | null = null;
  #interactiveContext: IGraphicContext | null = null;
  #frameHandler: FrameHandler;
  #editor: Editor;
  #renderTool: (ctx: IRenderer) => void;

  constructor(editor: Editor, renderTool: (ctx: IRenderer) => void) {
    this.#editor = editor;
    this.#renderTool = renderTool;
    this.#frameHandler = new FrameHandler();
  }

  setStaticContext(context: IGraphicContext): void {
    this.#staticContext = context;
  }

  setInteractiveContext(context: IGraphicContext): void {
    this.#interactiveContext = context;
  }

  requestRedraw(): void {
    this.#frameHandler.requestUpdate(() => this.#draw());
  }

  requestImmediateRedraw(): void {
    this.#draw();
  }

  cancelRedraw(): void {
    this.#frameHandler.cancelUpdate();
  }

  #draw(): void {
    this.#drawInteractive();
    this.#drawStatic();
  }

  #prepareCanvas(ctx: IRenderer): void {
    this.#applyUserTransforms(ctx);
    this.#applyUpmTransforms(ctx);
  }

  #applyUserTransforms(ctx: IRenderer): void {
    const viewport = this.#editor.viewportManager;
    const center = viewport.getCentrePoint();
    const zoom = viewport.zoom.peek();
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
    if (!this.#interactiveContext) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    this.#renderTool(ctx);

    ctx.restore();
  }

  #drawStatic(): void {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();

    const glyph = this.#editor.getGlyph();
    const previewMode = this.#editor.previewMode.peek();
    const handlesVisible = this.#editor.handlesVisible.peek();

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
      const hasClosed = renderGlyph(ctx, glyph as GlyphSnapshot);

      if (hasClosed && previewMode) {
        ctx.fillStyle = "black";
        ctx.beginPath();
        for (const contour of glyph.contours) {
          buildContourPath(ctx, contour as ContourSnapshot);
        }
        ctx.fill();
      }
    }

    if (!previewMode && glyph) {
      this.#drawSegmentHighlights(ctx, glyph);
    }

    const shouldDrawBoundingRect =
      this.#editor.selectedPointIds.peek().size > 1 &&
      !previewMode &&
      this.#editor.selectionMode.peek() === "committed";

    let bbRect: ReturnType<typeof Polygon.boundingRect> = null;
    if (shouldDrawBoundingRect) {
      const selectedPointData = this.#getSelectedPointData();
      bbRect = Polygon.boundingRect(selectedPointData);
      if (bbRect) {
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.lineWidth = this.#lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
        ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
      }
    }

    ctx.restore();
    ctx.save();

    if (!previewMode && handlesVisible && glyph) {
      this.#drawHandlesFromSnapshot(ctx, glyph);
    }

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
      capHeight: { y: metrics.capHeight },
      xHeight: { y: metrics.xHeight },
      baseline: { y: 0 },
      descender: { y: metrics.descender },
      xAdvance: glyph.xAdvance,
    };
  }

  #getSelectedPointData(): Array<{ x: number; y: number }> {
    return Array.from(this.#editor.selectedPointIds.peek())
      .map((id) => this.#editor.getPointById(id))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({ x: p.x, y: p.y }));
  }

  #drawSegmentHighlights(ctx: IRenderer, glyph: Glyph): void {
    const hoveredSegment = this.#editor.hoveredSegmentId.peek();
    const selectedSegments = this.#editor.selectedSegmentIds.peek();

    if (!hoveredSegment && selectedSegments.size === 0) return;

    for (const contour of glyph.contours) {
      const segments = Segment.parse(contour.points as PointSnapshot[], contour.closed);

      for (const segment of segments) {
        const segmentId = Segment.id(segment);
        const isHovered = hoveredSegment?.segmentId === segmentId;
        const isSelected = selectedSegments.has(segmentId);

        if (!isHovered && !isSelected) continue;

        const style = isSelected ? SEGMENT_SELECTED_STYLE : SEGMENT_HOVER_STYLE;
        ctx.setStyle(style);
        ctx.lineWidth = this.#lineWidthUpm(style.lineWidth);

        this.#drawSegmentCurve(ctx, segment);
      }
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

  #drawHandlesFromSnapshot(ctx: IRenderer, glyph: Glyph): void {
    const viewport = this.#editor.viewportManager;

    ctx.setStyle(DEFAULT_STYLES);
    for (const contour of glyph.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        if (point.pointType !== "offCurve") continue;

        const { x, y } = viewport.projectUpmToScreen(point.x, point.y);
        const nextPoint = points[(idx + 1) % numPoints];
        const prevPoint = points[(idx - 1 + numPoints) % numPoints];

        const anchor = nextPoint.pointType === "offCurve" ? prevPoint : nextPoint;

        if (!anchor || anchor.pointType === "offCurve") continue;

        const { x: anchorX, y: anchorY } = viewport.projectUpmToScreen(anchor.x, anchor.y);

        ctx.drawLine(anchorX, anchorY, x, y);
      }
    }

    for (const contour of glyph.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        const { x, y } = viewport.projectUpmToScreen(point.x, point.y);
        const handleState = this.#editor.getHandleState(asPointId(point.id));

        if (numPoints === 1) {
          drawHandle(ctx, "corner", x, y, handleState);
          continue;
        }

        const isFirst = idx === 0;
        const isLast = idx === numPoints - 1;

        if (isFirst) {
          const nextPoint = points[1];
          const { x: nx, y: ny } = viewport.projectUpmToScreen(nextPoint.x, nextPoint.y);
          const segmentAngle = Math.atan2(ny - y, nx - x);

          if (contour.closed) {
            drawHandle(ctx, "direction", x, y, handleState, { segmentAngle });
          } else {
            drawHandle(ctx, "first", x, y, handleState, { segmentAngle });
          }
          continue;
        }

        if (isLast && !contour.closed) {
          const prevPoint = points[idx - 1];
          const { x: px, y: py } = viewport.projectUpmToScreen(prevPoint.x, prevPoint.y);
          drawHandleLast(ctx, { x0: x, y0: y, x1: px, y1: py }, handleState);
          continue;
        }

        if (point.pointType === "onCurve") {
          if (point.smooth) {
            drawHandle(ctx, "smooth", x, y, handleState);
          } else {
            drawHandle(ctx, "corner", x, y, handleState);
          }
        } else {
          drawHandle(ctx, "control", x, y, handleState);
        }
      }
    }
  }

  destroy(): void {
    this.#staticContext?.destroy();
    this.#interactiveContext?.destroy();
  }
}
