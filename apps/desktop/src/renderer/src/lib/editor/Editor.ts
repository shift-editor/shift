import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SEGMENT_HOVER_STYLE,
} from "@/lib/styles/style";
import { tools } from "@/lib/tools/tools";
import AppState from "@/store/store";
import { IGraphicContext, IRenderer } from "@/types/graphics";
import { HandleState, HandleType } from "@/types/handle";
import { Point2D, Rect2D } from "@/types/math";
import { Tool, ToolContext } from "@/types/tool";
import type { PointId } from "@/types/ids";
import { asPointId, asContourId } from "@/types/ids";
import type { GlyphSnapshot, PointSnapshot } from "@/types/generated";

import { FrameHandler } from "./FrameHandler";
import { drawHandle, drawHandleLast } from "./handles";
import {
  createIndicatorManager,
  type IndicatorManager,
} from "./IndicatorManager";
import {
  createSelectionManager,
  type SelectionManager,
  type SelectionMode,
} from "./SelectionManager";
import { Viewport } from "./Viewport";
import { getBoundingRect } from "../math/rect";
import { FontEngine } from "@/engine";
import {
  findPointInSnapshot,
  renderGlyph,
  renderGuides,
  type Guides,
} from "./render";
import {
  CommandHistory,
  AddPointCommand,
  MovePointsCommand,
  RemovePointsCommand,
  CloseContourCommand,
  AddContourCommand,
} from "../commands";
import { effect, type Effect } from "../reactive/signal";
import { parseSegments } from "@/engine/segments";
import { Segment } from "../geo";
import { signal, type WritableSignal } from "../reactive/signal";

const DEBUG = false;

// ============================================================================
// Cursor Types
// ============================================================================

export type CursorType =
  | { type: "default" }
  | { type: "pointer" }
  | { type: "grab" }
  | { type: "grabbing" }
  | { type: "move" }
  | { type: "crosshair" }
  | { type: "pen" }
  | { type: "not-allowed" };

/** Convert a CursorType to a CSS cursor string */
function cursorToCSS(cursor: CursorType): string {
  switch (cursor.type) {
    case "pen":
      return `-webkit-image-set(url("/cursors/pen@32.svg") 1x, url("/cursors/pen@64.svg") 2x) 8 8, crosshair`;
    default:
      return cursor.type;
  }
}
const SCREEN_HIT_RADIUS = 8;
const SCREEN_LINE_WIDTH = 1;

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Editor]", ...args);
  }
}

export type { SelectionMode };

interface EditorState {
  fillContour: boolean;
}

export const InitialEditorState: EditorState = {
  fillContour: false,
};

function isContourClockwise(points: PointSnapshot[]): boolean {
  if (points.length < 3) return true;

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += (p2.x - p1.x) * (p2.y + p1.y);
  }

  return sum > 0;
}

export class Editor {
  #state: EditorState;
  #selection: SelectionManager;
  #indicators: IndicatorManager;

  #viewport: Viewport;
  #frameHandler: FrameHandler;

  #commandHistory: CommandHistory;

  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;

  #fontEngine: FontEngine;
  #redrawEffect: Effect;

  /** Reactive cursor signal - subscribe to this for cursor changes */
  #cursor: WritableSignal<string>;

  constructor() {
    this.#viewport = new Viewport();
    this.#frameHandler = new FrameHandler();

    this.#fontEngine = new FontEngine();

    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.snapshot.value,
    );

    this.#staticContext = null;
    this.#interactiveContext = null;

    this.#state = { ...InitialEditorState };
    this.#selection = createSelectionManager();
    this.#indicators = createIndicatorManager();
    this.#cursor = signal("default");

    this.#redrawEffect = effect(() => {
      this.#fontEngine.snapshot.value;
      this.#selection.selectedPoints;
      this.#selection.mode;
      this.#indicators.hoveredPoint;
      this.#indicators.hoveredSegment;
      this.requestRedraw();
    });
  }

  public setStaticContext(context: IGraphicContext) {
    this.#staticContext = context;
  }

  public setInteractiveContext(context: IGraphicContext) {
    this.#interactiveContext = context;
  }

  public startEditSession(unicode: number): void {
    debug("Starting edit session for unicode:", unicode);
    this.#fontEngine.session.startEditSession(unicode);
    this.#fontEngine.editing.addContour();
  }

  public endEditSession(): void {
    this.#fontEngine.session.endEditSession();
  }

  public getSnapshot(): GlyphSnapshot | null {
    return this.#fontEngine.snapshot.value;
  }

  public createToolContext(): ToolContext {
    const viewport = this.#viewport;
    const selection = this.#selection;
    const indicators = this.#indicators;
    const fontEngine = this.#fontEngine;
    const commands = this.#commandHistory;
    const requestRedraw = () => this.requestRedraw();

    return {
      snapshot: fontEngine.snapshot.value,
      selectedPoints: selection.selectedPoints,
      hoveredPoint: indicators.hoveredPoint,
      hoveredSegment: indicators.hoveredSegment,
      mousePosition: viewport.getUpmMousePosition(),
      selectionMode: selection.mode,

      screen: {
        toUpmDistance: (px) => viewport.screenToUpmDistance(px),
        get hitRadius() {
          return viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);
        },
        lineWidth: (px = 1) => viewport.screenToUpmDistance(px),
      },

      select: {
        set: (ids) => selection.selectMultiple(ids),
        add: (id) => selection.addToSelection(id),
        remove: (id) => selection.removeFromSelection(id),
        toggle: (id) => selection.toggleSelection(id),
        clear: () => selection.clearSelection(),
        has: () => selection.hasSelection(),
        setMode: (mode) => selection.setMode(mode),
      },

      indicators: {
        setHoveredPoint: (id) => indicators.setHoveredPoint(id),
        setHoveredSegment: (indicator) =>
          indicators.setHoveredSegment(indicator),
        clearAll: () => indicators.clearAll(),
      },

      edit: {
        addPoint: (x, y, type) => {
          const cmd = new AddPointCommand(x, y, type, false);
          return commands.execute(cmd);
        },
        movePoints: (ids, dx, dy) => {
          const cmd = new MovePointsCommand([...ids], dx, dy);
          commands.execute(cmd);
        },
        movePointTo: (id, x, y) => {
          fontEngine.editing.movePointTo(id, x, y);
        },
        applySmartEdits: (ids, dx, dy) => {
          return fontEngine.editEngine.applyEdits(ids, dx, dy);
        },
        removePoints: (ids) => {
          const cmd = new RemovePointsCommand([...ids]);
          commands.execute(cmd);
        },
        addContour: () => {
          const cmd = new AddContourCommand();
          return commands.execute(cmd);
        },
        closeContour: () => {
          const cmd = new CloseContourCommand();
          commands.execute(cmd);
        },
        toggleSmooth: (id) => {
          fontEngine.editing.toggleSmooth(id);
        },
        getActiveContourId: () => {
          const id = fontEngine.editing.getActiveContourId();
          return id ? asContourId(id) : null;
        },
      },

      commands,
      requestRedraw,
    };
  }

  public get commandHistory(): CommandHistory {
    return this.#commandHistory;
  }

  public activeTool(): Tool {
    const activeTool = AppState.getState().activeTool;
    const tool = tools.get(activeTool);
    if (!tool) {
      throw new Error(`Tool ${activeTool} not found`);
    }
    return tool.tool;
  }

  public undo() {
    this.#commandHistory.undo();
    this.redrawGlyph();
  }

  public redo() {
    this.#commandHistory.redo();
    this.redrawGlyph();
  }

  public setViewportRect(rect: Rect2D) {
    this.#viewport.setRect(rect);
  }

  public setViewportUpm(upm: number) {
    this.#viewport.upm = upm;
  }

  public updateMetricsFromFont(): void {
    const metrics = this.#fontEngine.info.getMetrics();
    this.#viewport.upm = metrics.unitsPerEm;
    this.#viewport.descender = metrics.descender;
    this.requestRedraw();
  }

  public getMousePosition(x?: number, y?: number): Point2D {
    if (x === undefined || y === undefined) {
      return this.#viewport.getMousePosition();
    }

    return this.#viewport.getMousePosition(x, y);
  }

  public getUpmMousePosition(): Point2D {
    return this.#viewport.getUpmMousePosition();
  }

  public projectScreenToUpm(x: number, y: number): Point2D {
    return this.#viewport.projectScreenToUpm(x, y);
  }

  public setUpmMousePosition(x: number, y: number) {
    this.#viewport.setUpmMousePosition(x, y);
  }

  public pan(dx: number, dy: number) {
    this.#viewport.pan(dx, dy);
  }

  public getPan(): Point2D {
    return { x: this.#viewport.panX, y: this.#viewport.panY };
  }

  public zoomIn(): void {
    this.#viewport.zoomIn();
  }

  public zoomOut(): void {
    this.#viewport.zoomOut();
  }

  public zoomToPoint(
    screenX: number,
    screenY: number,
    zoomDelta: number,
  ): void {
    this.#viewport.zoomToPoint(screenX, screenY, zoomDelta);
  }

  public zoom(): number {
    return this.#viewport.zoom;
  }

  public getHandleState(pointId: PointId): HandleState {
    if (this.#selection.isSelected(pointId)) {
      return "selected";
    }
    if (this.#indicators.hoveredPoint === pointId) {
      return "hovered";
    }
    return "idle";
  }

  public paintHandle(
    ctx: IRenderer,
    x: number,
    y: number,
    handleType: Exclude<HandleType, "last">,
    state: HandleState,
    isCounterClockWise?: boolean,
  ) {
    drawHandle(ctx, handleType, x, y, state, { isCounterClockWise });
  }

  public getFontMetrics() {
    return this.#fontEngine.info.getMetrics();
  }

  public getFontMetadata() {
    return this.#fontEngine.info.getMetadata();
  }

  public loadFont(filePath: string): void {
    this.#fontEngine.io.loadFont(filePath);
  }

  public get selectedPoints(): ReadonlySet<PointId> {
    return this.#selection.selectedPoints;
  }

  /** Get the current cursor value */
  public get cursor(): string {
    return this.#cursor.value;
  }

  /** Get the cursor signal for reactive subscriptions */
  public get cursorSignal(): WritableSignal<string> {
    return this.#cursor;
  }

  /** Set the cursor style using a discriminated union type */
  public setCursor(cursor: CursorType): void {
    this.#cursor.set(cursorToCSS(cursor));
  }

  public deleteSelectedPoints(): void {
    if (this.#selection.selectedPoints.size > 0) {
      this.#fontEngine.editing.removePoints([
        ...this.#selection.selectedPoints,
      ]);
      this.#selection.clearSelection();
      this.requestRedraw();
    }
  }

  public findPoint(pointId: PointId): PointSnapshot | null {
    const snapshot = this.#fontEngine.snapshot.value;
    if (!snapshot) return null;

    const result = findPointInSnapshot(snapshot, pointId);
    return result?.point ?? null;
  }

  #getSelectedPointData(): Array<{ x: number; y: number }> {
    const snapshot = this.#fontEngine.snapshot.value;
    if (!snapshot) return [];

    const result: Array<{ x: number; y: number }> = [];
    for (const pointId of this.#selection.selectedPoints) {
      const found = findPointInSnapshot(snapshot, pointId);
      if (found) {
        result.push({ x: found.point.x, y: found.point.y });
      }
    }
    return result;
  }

  #lineWidthUpm(screenPixels = SCREEN_LINE_WIDTH): number {
    return this.#viewport.screenToUpmDistance(screenPixels);
  }

  public setFillContour(fillContour: boolean) {
    this.#state.fillContour = fillContour;
  }

  #applyUserTransforms(ctx: IRenderer) {
    const center = this.#viewport.getCentrePoint();
    const zoom = this.#viewport.zoom;
    const { panX, panY } = this.#viewport;

    ctx.transform(
      zoom,
      0,
      0,
      zoom,
      panX + center.x * (1 - zoom),
      panY + center.y * (1 - zoom),
    );
  }

  #applyUpmTransforms(ctx: IRenderer) {
    const scale = this.#viewport.upmScale;
    const baselineY =
      this.#viewport.logicalHeight -
      this.#viewport.padding -
      this.#viewport.descender * scale;
    ctx.transform(scale, 0, 0, -scale, this.#viewport.padding, baselineY);
  }

  public redrawGlyph() {
    this.requestRedraw();
  }

  #prepareCanvas(ctx: IRenderer) {
    this.#applyUserTransforms(ctx);
    this.#applyUpmTransforms(ctx);
  }

  #drawInteractive() {
    if (!this.#interactiveContext) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    const tool = this.activeTool();
    if (tool.drawInteractive) {
      tool.drawInteractive(ctx);
    }

    ctx.restore();
  }

  #drawStatic() {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();

    const snapshot = this.#fontEngine.snapshot.value;

    debug("drawStatic: snapshot contours:", snapshot?.contours.length ?? 0);

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    if (snapshot) {
      const guides = this.#getGuides(snapshot);
      ctx.setStyle(GUIDE_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(GUIDE_STYLES.lineWidth);

      if (!this.#state.fillContour) {
        renderGuides(ctx, guides);
      }

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(DEFAULT_STYLES.lineWidth);
      const hasClosed = renderGlyph(ctx, snapshot);

      if (hasClosed && this.#state.fillContour) {
        ctx.fillStyle = "black";
        for (const contour of snapshot.contours) {
          if (contour.closed) {
            ctx.beginPath();
            for (const point of contour.points) {
              ctx.lineTo(point.x, point.y);
            }
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    if (!this.#state.fillContour && snapshot) {
      this.#drawSegmentIndicator(ctx, snapshot);
    }

    const shouldDrawBoundingRect =
      this.#selection.selectedPoints.size > 0 &&
      !this.#state.fillContour &&
      this.#selection.mode === "committed";

    if (shouldDrawBoundingRect) {
      const selectedPointData = this.#getSelectedPointData();
      if (selectedPointData.length > 0) {
        const bbRect = getBoundingRect(selectedPointData);
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.lineWidth = this.#lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
        ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
      }
    }

    ctx.restore();
    ctx.save();

    if (!this.#state.fillContour && snapshot) {
      this.#drawHandlesFromSnapshot(ctx, snapshot);
    }

    ctx.restore();
  }

  #getGuides(snapshot: GlyphSnapshot): Guides {
    const metrics = this.#fontEngine.info.getMetrics();
    return {
      ascender: { y: metrics.ascender },
      capHeight: { y: metrics.capHeight },
      xHeight: { y: metrics.xHeight },
      baseline: { y: 0 },
      descender: { y: metrics.descender },
      xAdvance: snapshot.xAdvance,
    };
  }

  #drawSegmentIndicator(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    const hoveredSegment = this.#indicators.hoveredSegment;
    if (!hoveredSegment) return;

    for (const contour of snapshot.contours) {
      const segments = parseSegments(contour.points, contour.closed);

      for (const segment of segments) {
        const segmentId = Segment.id(segment);
        if (segmentId !== hoveredSegment.segmentId) continue;

        ctx.setStyle(SEGMENT_HOVER_STYLE);
        ctx.lineWidth = this.#lineWidthUpm(SEGMENT_HOVER_STYLE.lineWidth);

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
        return;
      }
    }
  }

  #drawHandlesFromSnapshot(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    for (const contour of snapshot.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        const { x, y } = this.#viewport.projectUpmToScreen(point.x, point.y);
        const handleState = this.getHandleState(asPointId(point.id));

        if (numPoints === 1) {
          this.paintHandle(ctx, x, y, "corner", handleState);
          continue;
        }

        const isFirst = idx === 0;
        const isLast = idx === numPoints - 1;

        if (isFirst) {
          if (contour.closed) {
            const clockwise = isContourClockwise(points);
            this.paintHandle(ctx, x, y, "direction", handleState, !clockwise);
          } else {
            this.paintHandle(ctx, x, y, "first", handleState);
          }
          continue;
        }

        if (isLast && !contour.closed) {
          const prevPoint = points[idx - 1];
          const { x: px, y: py } = this.#viewport.projectUpmToScreen(
            prevPoint.x,
            prevPoint.y,
          );
          drawHandleLast(ctx, { x0: x, y0: y, x1: px, y1: py }, handleState);
          continue;
        }

        if (point.pointType === "onCurve") {
          if (point.smooth) {
            this.paintHandle(ctx, x, y, "smooth", handleState);
          } else {
            this.paintHandle(ctx, x, y, "corner", handleState);
          }
        } else {
          const nextPoint = points[(idx + 1) % numPoints];
          const prevPoint = points[idx - 1];

          const anchor =
            nextPoint.pointType === "offCurve" ? prevPoint : nextPoint;

          const { x: anchorX, y: anchorY } = this.#viewport.projectUpmToScreen(
            anchor.x,
            anchor.y,
          );

          this.paintHandle(ctx, x, y, "control", handleState);

          ctx.setStyle(DEFAULT_STYLES);
          ctx.drawLine(anchorX, anchorY, x, y);
        }
      }
    }
  }

  #draw() {
    this.#drawInteractive();
    this.#drawStatic();
  }

  public requestRedraw() {
    this.#frameHandler.requestUpdate(() => this.#draw());
  }

  public requestImmediateRedraw() {
    this.#draw();
  }

  public cancelRedraw() {
    this.#frameHandler.cancelUpdate();
  }

  public destroy() {
    this.#redrawEffect.dispose();

    if (this.#staticContext) {
      this.#staticContext.destroy();
    }

    if (this.#interactiveContext) {
      this.#interactiveContext.destroy();
    }
  }
}
