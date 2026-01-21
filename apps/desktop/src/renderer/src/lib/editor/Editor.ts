import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SEGMENT_HOVER_STYLE,
  SEGMENT_SELECTED_STYLE,
} from "@/lib/styles/style";
import { IGraphicContext, IRenderer } from "@/types/graphics";
import { HandleState, HandleType } from "@/types/handle";
import { Point2D, Rect2D } from "@/types/math";
import { Tool, ToolContext, ToolName } from "@/types/tool";
import type { PointId } from "@/types/ids";
import { asPointId, asContourId } from "@/types/ids";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { GlyphSnapshot, PointSnapshot } from "@/types/generated";

import { FrameHandler } from "./FrameHandler";
import { drawHandle, drawHandleLast } from "./handles";
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

// ============================================================================
// Selection Types
// ============================================================================

export type SelectionMode = "preview" | "committed";

// ============================================================================
// Visual State Types
// ============================================================================

export type VisualState = "idle" | "hovered" | "selected";

// ============================================================================
// Tool Registry Types
// ============================================================================

export interface ToolRegistryItem {
  tool: Tool;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
}

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
  #previewMode: WritableSignal<boolean>;

  #selectedPointIds: WritableSignal<ReadonlySet<PointId>>;
  #selectedSegmentIds: WritableSignal<ReadonlySet<SegmentId>>;
  #selectionMode: WritableSignal<SelectionMode>;

  #hoveredPointId: WritableSignal<PointId | null>;
  #hoveredSegmentId: WritableSignal<SegmentIndicator | null>;

  #tools: Map<ToolName, ToolRegistryItem>;
  #activeTool: WritableSignal<ToolName>;

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

    this.#previewMode = signal(false);
    this.#cursor = signal("default");

    this.#selectedPointIds = signal<ReadonlySet<PointId>>(new Set());
    this.#selectedSegmentIds = signal<ReadonlySet<SegmentId>>(new Set());
    this.#selectionMode = signal<SelectionMode>("committed");

    this.#hoveredPointId = signal<PointId | null>(null);
    this.#hoveredSegmentId = signal<SegmentIndicator | null>(null);

    this.#tools = new Map();
    this.#activeTool = signal<ToolName>("select");

    this.#redrawEffect = effect(() => {
      this.#fontEngine.snapshot.value;
      this.#selectedPointIds.value;
      this.#selectedSegmentIds.value;
      this.#selectionMode.value;
      this.#hoveredPointId.value;
      this.#hoveredSegmentId.value;
      this.#previewMode.value;
      this.requestRedraw();
    });
  }

  public registerTool(
    name: ToolName,
    tool: Tool,
    icon: React.FC<React.SVGProps<SVGSVGElement>>,
    tooltip: string,
  ): void {
    this.#tools.set(name, { tool, icon, tooltip });
  }

  public get tools(): ReadonlyMap<ToolName, ToolRegistryItem> {
    return this.#tools;
  }

  public get activeTool(): ToolName {
    return this.#activeTool.value;
  }

  public get activeToolSignal(): WritableSignal<ToolName> {
    return this.#activeTool;
  }

  public setActiveTool(toolName: ToolName): void {
    const currentToolName = this.#activeTool.value;
    if (currentToolName === toolName) return;

    // Deactivate the current tool
    const oldTool = this.#tools.get(currentToolName);
    if (oldTool) {
      oldTool.tool.setIdle();
    }

    // Activate the new tool
    const newTool = this.#tools.get(toolName);
    if (newTool) {
      newTool.tool.setReady();
    }

    this.#activeTool.set(toolName);
  }

  public getActiveTool(): Tool {
    const tool = this.#tools.get(this.#activeTool.value);
    if (!tool) {
      throw new Error(`Tool ${this.#activeTool.value} not found`);
    }
    return tool.tool;
  }

  public get selectedPointIds(): ReadonlySet<PointId> {
    return this.#selectedPointIds.value;
  }

  public selectPoint(pointId: PointId): void {
    this.#selectedPointIds.set(new Set([pointId]));
  }

  public selectPoints(pointIds: Set<PointId>): void {
    this.#selectedPointIds.set(new Set(pointIds));
  }

  public addPointToSelection(pointId: PointId): void {
    const next = new Set(this.#selectedPointIds.peek());
    next.add(pointId);
    this.#selectedPointIds.set(next);
  }

  public removePointFromSelection(pointId: PointId): void {
    const next = new Set(this.#selectedPointIds.peek());
    next.delete(pointId);
    this.#selectedPointIds.set(next);
  }

  public togglePointSelection(pointId: PointId): void {
    const next = new Set(this.#selectedPointIds.peek());
    if (next.has(pointId)) {
      next.delete(pointId);
    } else {
      next.add(pointId);
    }
    this.#selectedPointIds.set(next);
  }

  public isPointSelected(pointId: PointId): boolean {
    return this.#selectedPointIds.peek().has(pointId);
  }

  public get selectedSegmentIds(): ReadonlySet<SegmentId> {
    return this.#selectedSegmentIds.value;
  }

  public selectSegment(segmentId: SegmentId): void {
    this.#selectedSegmentIds.set(new Set([segmentId]));
  }

  public selectSegments(segmentIds: Set<SegmentId>): void {
    this.#selectedSegmentIds.set(new Set(segmentIds));
  }

  public addSegmentToSelection(segmentId: SegmentId): void {
    const next = new Set(this.#selectedSegmentIds.peek());
    next.add(segmentId);
    this.#selectedSegmentIds.set(next);
  }

  public removeSegmentFromSelection(segmentId: SegmentId): void {
    const next = new Set(this.#selectedSegmentIds.peek());
    next.delete(segmentId);
    this.#selectedSegmentIds.set(next);
  }

  public toggleSegmentInSelection(segmentId: SegmentId): void {
    const next = new Set(this.#selectedSegmentIds.peek());
    if (next.has(segmentId)) {
      next.delete(segmentId);
    } else {
      next.add(segmentId);
    }
    this.#selectedSegmentIds.set(next);
  }

  public isSegmentSelected(segmentId: SegmentId): boolean {
    return this.#selectedSegmentIds.peek().has(segmentId);
  }

  public clearSelection(): void {
    this.#selectedPointIds.set(new Set());
    this.#selectedSegmentIds.set(new Set());
  }

  public hasSelection(): boolean {
    return (
      this.#selectedPointIds.peek().size > 0 ||
      this.#selectedSegmentIds.peek().size > 0
    );
  }

  public get selectionMode(): SelectionMode {
    return this.#selectionMode.value;
  }

  public setSelectionMode(mode: SelectionMode): void {
    this.#selectionMode.set(mode);
  }

  public get hoveredPointId(): PointId | null {
    return this.#hoveredPointId.value;
  }

  public get hoveredSegmentId(): SegmentIndicator | null {
    return this.#hoveredSegmentId.value;
  }

  public setHoveredPoint(pointId: PointId | null): void {
    this.#hoveredPointId.set(pointId);
    if (pointId !== null) {
      this.#hoveredSegmentId.set(null);
    }
  }

  public setHoveredSegment(indicator: SegmentIndicator | null): void {
    this.#hoveredSegmentId.set(indicator);
    if (indicator !== null) {
      this.#hoveredPointId.set(null);
    }
  }

  public clearHover(): void {
    this.#hoveredPointId.set(null);
    this.#hoveredSegmentId.set(null);
  }

  public getPointVisualState(pointId: PointId): VisualState {
    if (this.isPointSelected(pointId)) {
      return "selected";
    }
    if (this.#hoveredPointId.value === pointId) {
      return "hovered";
    }

    const hoveredSegment = this.#hoveredSegmentId.value;
    if (hoveredSegment) {
      const segmentPointIds = this.#getPointIdsFromSegmentId(
        hoveredSegment.segmentId,
      );
      if (segmentPointIds.has(pointId)) {
        return "hovered";
      }
    }
    return "idle";
  }

  public getSegmentVisualState(segmentId: SegmentId): VisualState {
    if (this.isSegmentSelected(segmentId)) {
      return "selected";
    }
    if (this.#hoveredSegmentId.value?.segmentId === segmentId) {
      return "hovered";
    }
    return "idle";
  }

  #getPointIdsFromSegmentId(segmentId: SegmentId): Set<PointId> {
    const [id1, id2] = segmentId.split(":");
    return new Set([asPointId(id1), asPointId(id2)]);
  }

  public get previewMode(): boolean {
    return this.#previewMode.value;
  }

  public setPreviewMode(enabled: boolean): void {
    this.#previewMode.set(enabled);
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
    const fontEngine = this.#fontEngine;
    const commands = this.#commandHistory;
    const requestRedraw = () => this.requestRedraw();

    return {
      snapshot: fontEngine.snapshot.value,
      selectedPoints: this.selectedPointIds,
      hoveredPoint: this.hoveredPointId,
      hoveredSegment: this.hoveredSegmentId,
      mousePosition: viewport.getUpmMousePosition(),
      selectionMode: this.selectionMode,

      screen: {
        toUpmDistance: (px) => viewport.screenToUpmDistance(px),
        get hitRadius() {
          return viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);
        },
        lineWidth: (px = 1) => viewport.screenToUpmDistance(px),
      },

      select: {
        set: (ids) => this.selectPoints(ids),
        add: (id) => this.addPointToSelection(id),
        remove: (id) => this.removePointFromSelection(id),
        toggle: (id) => this.togglePointSelection(id),
        clear: () => this.clearSelection(),
        has: () => this.hasSelection(),
        setMode: (mode) => this.setSelectionMode(mode),
      },

      indicators: {
        setHoveredPoint: (id) => this.setHoveredPoint(id),
        setHoveredSegment: (indicator) => this.setHoveredSegment(indicator),
        clearAll: () => this.clearHover(),
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
    return this.getPointVisualState(pointId);
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
    if (this.#fontEngine.session.isActive()) {
      this.#fontEngine.session.endEditSession();
    }
    this.#fontEngine.io.loadFont(filePath);
    this.#commandHistory.clear();
    this.startEditSession(65);
  }

  public saveFont(filePath: string): void {
    this.#fontEngine.io.saveFont(filePath);
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
    if (this.#selectedPointIds.peek().size > 0) {
      this.#fontEngine.editing.removePoints([...this.#selectedPointIds.peek()]);
      this.clearSelection();
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
    for (const pointId of this.#selectedPointIds.peek()) {
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

    const tool = this.getActiveTool();
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

      if (!this.previewMode) {
        renderGuides(ctx, guides);
      }

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = this.#lineWidthUpm(DEFAULT_STYLES.lineWidth);
      const hasClosed = renderGlyph(ctx, snapshot);

      if (hasClosed && this.previewMode) {
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

    if (!this.previewMode && snapshot) {
      this.#drawSegmentHighlights(ctx, snapshot);
    }

    const shouldDrawBoundingRect =
      this.#selectedPointIds.peek().size > 0 &&
      !this.previewMode &&
      this.selectionMode === "committed";

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

    if (!this.previewMode && snapshot) {
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

  #drawSegmentHighlights(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    const hoveredSegment = this.#hoveredSegmentId.value;
    const selectedSegments = this.#selectedSegmentIds.peek();

    // Nothing to draw
    if (!hoveredSegment && selectedSegments.size === 0) return;

    for (const contour of snapshot.contours) {
      const segments = parseSegments(contour.points, contour.closed);

      for (const segment of segments) {
        const segmentId = Segment.id(segment);
        const isHovered = hoveredSegment?.segmentId === segmentId;
        const isSelected = selectedSegments.has(segmentId);

        if (!isHovered && !isSelected) continue;

        // Selected takes priority over hovered for styling
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
