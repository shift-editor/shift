import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SEGMENT_HOVER_STYLE,
  SEGMENT_SELECTED_STYLE,
} from "@/lib/styles/style";
import type { IGraphicContext, IRenderer } from "@/types/graphics";
import type { HandleState, HandleType } from "@/types/handle";
import type { GlyphSnapshot, PointId } from "@shift/types";
import { asPointId } from "@shift/types";
import type { Tool } from "@/types/tool";

import { FrameHandler } from "./FrameHandler";
import { drawHandleLast } from "./handles";
import type { Viewport } from "./Viewport";
import { getBoundingRect } from "../math/rect";
import {
  renderGlyph,
  renderGuides,
  buildContourPath,
  type Guides,
} from "./render";
import { parseSegments } from "@/engine/segments";
import { Segment } from "@/lib/geo/Segment";
import type { SelectionManager } from "./SelectionManager";
import type { HoverManager } from "./HoverManager";

const DEBUG = false;
const SCREEN_LINE_WIDTH = 1;

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log("[GlyphRenderer]", ...args);
  }
}

export interface FontMetrics {
  ascender: number;
  capHeight: number;
  xHeight: number;
  descender: number;
}

export interface RenderDependencies {
  viewport: Viewport;
  getSnapshot: () => GlyphSnapshot | null;
  getFontMetrics: () => FontMetrics;
  getActiveTool: () => Tool;
  selection: SelectionManager;
  hover: HoverManager;
  getPreviewMode: () => boolean;
  getHandleState: (pointId: PointId) => HandleState;
  paintHandle: (
    ctx: IRenderer,
    x: number,
    y: number,
    handleType: Exclude<HandleType, "last">,
    state: HandleState,
    segmentAngle?: number,
  ) => void;
  getSelectedPointData: () => Array<{ x: number; y: number }>;
}

export class GlyphRenderer {
  #staticContext: IGraphicContext | null = null;
  #interactiveContext: IGraphicContext | null = null;
  #frameHandler: FrameHandler;
  #deps: RenderDependencies;

  constructor(deps: RenderDependencies) {
    this.#deps = deps;
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
    const viewport = this.#deps.viewport;
    const center = viewport.getCentrePoint();
    const zoom = viewport.zoom;
    const { panX, panY } = viewport;

    ctx.transform(
      zoom,
      0,
      0,
      zoom,
      panX + center.x * (1 - zoom),
      panY + center.y * (1 - zoom),
    );
  }

  #applyUpmTransforms(ctx: IRenderer): void {
    const viewport = this.#deps.viewport;
    const scale = viewport.upmScale;
    const baselineY =
      viewport.logicalHeight - viewport.padding - viewport.descender * scale;
    ctx.transform(scale, 0, 0, -scale, viewport.padding, baselineY);
  }

  #lineWidthUpm(screenPixels = SCREEN_LINE_WIDTH): number {
    return this.#deps.viewport.screenToUpmDistance(screenPixels);
  }

  #drawInteractive(): void {
    if (!this.#interactiveContext) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    const tool = this.#deps.getActiveTool();
    if (tool.drawInteractive) {
      tool.drawInteractive(ctx);
    }

    ctx.restore();
  }

  #drawStatic(): void {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();

    const snapshot = this.#deps.getSnapshot();

    debug("drawStatic: snapshot contours:", snapshot?.contours.length ?? 0);

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    if (snapshot) {
      const guides = this.#getGuides(snapshot);
      ctx.setStyle(GUIDE_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(GUIDE_STYLES.lineWidth);

      if (!this.#deps.getPreviewMode()) {
        renderGuides(ctx, guides);
      }

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(DEFAULT_STYLES.lineWidth);
      const hasClosed = renderGlyph(ctx, snapshot);

      if (hasClosed && this.#deps.getPreviewMode()) {
        ctx.fillStyle = "black";
        ctx.beginPath();
        for (const contour of snapshot.contours) {
          buildContourPath(ctx, contour);
        }
        ctx.fill();
      }
    }

    if (!this.#deps.getPreviewMode() && snapshot) {
      this.#drawSegmentHighlights(ctx, snapshot);
    }

    const shouldDrawBoundingRect =
      this.#deps.selection.selectedPointIdsSignal.peek().size > 0 &&
      !this.#deps.getPreviewMode() &&
      this.#deps.selection.selectionMode === "committed";

    if (shouldDrawBoundingRect) {
      const selectedPointData = this.#deps.getSelectedPointData();
      if (selectedPointData.length > 0) {
        const bbRect = getBoundingRect(selectedPointData);
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.lineWidth = this.#lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
        ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
      }
    }

    ctx.restore();
    ctx.save();

    if (!this.#deps.getPreviewMode() && snapshot) {
      this.#drawHandlesFromSnapshot(ctx, snapshot);
    }

    ctx.restore();
  }

  #getGuides(snapshot: GlyphSnapshot): Guides {
    const metrics = this.#deps.getFontMetrics();
    return {
      ascender: { y: metrics.ascender },
      capHeight: { y: metrics.capHeight },
      xHeight: { y: metrics.xHeight },
      baseline: { y: 0 },
      descender: { y: metrics.descender },
      xAdvance: snapshot.xAdvance,
    };
  }

  #drawSegmentHighlights(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    const hoveredSegment = this.#deps.hover.hoveredSegmentId;
    const selectedSegments =
      this.#deps.selection.selectedSegmentIdsSignal.peek();

    if (!hoveredSegment && selectedSegments.size === 0) return;

    for (const contour of snapshot.contours) {
      const segments = parseSegments(contour.points, contour.closed);

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

  #drawSegmentCurve(
    ctx: IRenderer,
    segment: ReturnType<typeof parseSegments>[number],
  ): void {
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
        ctx.cubicTo(
          curve.c0.x,
          curve.c0.y,
          curve.c1.x,
          curve.c1.y,
          curve.p1.x,
          curve.p1.y,
        );
        break;
    }

    ctx.stroke();
  }

  #drawHandlesFromSnapshot(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    const viewport = this.#deps.viewport;

    // First pass: draw all handle lines (so handles appear on top)
    ctx.setStyle(DEFAULT_STYLES);
    for (const contour of snapshot.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        if (point.pointType !== "offCurve") continue;

        const { x, y } = viewport.projectUpmToScreen(point.x, point.y);
        const nextPoint = points[(idx + 1) % numPoints];
        const prevPoint = points[idx - 1];

        const anchor =
          nextPoint.pointType === "offCurve" ? prevPoint : nextPoint;

        const { x: anchorX, y: anchorY } = viewport.projectUpmToScreen(
          anchor.x,
          anchor.y,
        );

        ctx.drawLine(anchorX, anchorY, x, y);
      }
    }

    // Second pass: draw all handles (on top of lines)
    for (const contour of snapshot.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        const { x, y } = viewport.projectUpmToScreen(point.x, point.y);
        const handleState = this.#deps.getHandleState(asPointId(point.id));

        if (numPoints === 1) {
          this.#deps.paintHandle(ctx, x, y, "corner", handleState);
          continue;
        }

        const isFirst = idx === 0;
        const isLast = idx === numPoints - 1;

        if (isFirst) {
          const nextPoint = points[1];
          const { x: nx, y: ny } = viewport.projectUpmToScreen(
            nextPoint.x,
            nextPoint.y,
          );
          const segmentAngle = Math.atan2(ny - y, nx - x);

          if (contour.closed) {
            this.#deps.paintHandle(
              ctx,
              x,
              y,
              "direction",
              handleState,
              segmentAngle,
            );
          } else {
            this.#deps.paintHandle(ctx, x, y, "first", handleState, segmentAngle);
          }
          continue;
        }

        if (isLast && !contour.closed) {
          const prevPoint = points[idx - 1];
          const { x: px, y: py } = viewport.projectUpmToScreen(
            prevPoint.x,
            prevPoint.y,
          );
          drawHandleLast(ctx, { x0: x, y0: y, x1: px, y1: py }, handleState);
          continue;
        }

        if (point.pointType === "onCurve") {
          if (point.smooth) {
            this.#deps.paintHandle(ctx, x, y, "smooth", handleState);
          } else {
            this.#deps.paintHandle(ctx, x, y, "corner", handleState);
          }
        } else {
          this.#deps.paintHandle(ctx, x, y, "control", handleState);
        }
      }
    }
  }

  destroy(): void {
    this.#staticContext?.destroy();
    this.#interactiveContext?.destroy();
  }
}
