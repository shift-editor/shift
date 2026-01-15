import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
} from "@/lib/styles/style";
import { tools } from "@/lib/tools/tools";
import AppState from "@/store/store";
import { EventHandler, EventName, IEventEmitter } from "@/types/events";
import { IGraphicContext, IRenderer } from "@/types/graphics";
import { HandleState, HandleType } from "@/types/handle";
import { Point2D, Rect2D } from "@/types/math";
import { Tool, ToolContext } from "@/types/tool";
import type { PointId } from "@/types/ids";
import { asPointId } from "@/types/ids";
import type { GlyphSnapshot, PointSnapshot } from "@/types/generated";

import { FrameHandler } from "./FrameHandler";
import { Painter } from "./Painter";
import { Guides, Scene } from "./Scene";
import { Viewport } from "./Viewport";
import { UndoManager } from "../core/UndoManager";
import { Path2D } from "../graphics/Path";
import { getBoundingRect } from "../math/rect";
import { FontEngine } from "@/engine";
import { findPointInSnapshot } from "./render";
import { CommandHistory } from "../commands";

// Debug logging flag - set to true to enable debug output
const DEBUG = true;

function debug(...args: any[]) {
  if (DEBUG) {
    console.log("[Editor]", ...args);
  }
}

interface EditorState {
  /** Selected points by their Rust IDs. */
  selectedPoints: Set<PointId>;
  /** Hovered point by its Rust ID. */
  hoveredPoint: PointId | null;
  fillContour: boolean;
}

export const InitialEditorState: EditorState = {
  selectedPoints: new Set(),
  hoveredPoint: null,
  fillContour: false,
};

/**
 * Check if a contour is clockwise using the shoelace formula.
 */
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

  #viewport: Viewport;
  #scene: Scene;
  #painter: Painter;
  #frameHandler: FrameHandler;
  #eventEmitter: IEventEmitter;

  #undoManager: UndoManager;
  #commandHistory: CommandHistory;

  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;

  // Rust integration - FontEngine is the single source of truth
  #fontEngine: FontEngine;

  constructor(eventEmitter: IEventEmitter) {
    this.#viewport = new Viewport();
    this.#painter = new Painter();

    this.#scene = new Scene();
    this.#frameHandler = new FrameHandler();

    this.#undoManager = new UndoManager();

    // Initialize FontEngine first (needed for CommandHistory)
    this.#fontEngine = new FontEngine();

    // Initialize CommandHistory with FontEngine
    this.#commandHistory = new CommandHistory(
      this.#fontEngine,
      () => this.#fontEngine.snapshot
    );

    this.#eventEmitter = eventEmitter;

    this.#staticContext = null;
    this.#interactiveContext = null;

    this.#state = { ...InitialEditorState, selectedPoints: new Set() };

    // Subscribe to snapshot changes - Scene renders directly from snapshot
    this.#fontEngine.onChange((snapshot) => {
      debug("Snapshot changed:", snapshot?.contours.length, "contours");
      this.#scene.setSnapshot(snapshot);
      this.requestRedraw();
    });

    this.on("points:added", (points: any) => {
      this.#undoManager.push({
        undo: () => {
          for (const id of points.pointIds) {
            this.#fontEngine.editing.removePoints([id]);
          }
          this.redrawGlyph();
        },
      });
      this.redrawGlyph();
    });

    this.on("points:moved", (pointIds: any) => {
      this.#undoManager.push({
        undo: () => {
          for (const { pointId, fromX, fromY } of pointIds.points) {
            this.#fontEngine.editing.movePointTo(pointId, fromX, fromY);
          }

          this.redrawGlyph();
        },
      });
    });

    this.on("points:removed", (_pointIds) => {
      this.requestRedraw();
    });
  }

  public setStaticContext(context: IGraphicContext) {
    this.#staticContext = context;
  }

  public setInteractiveContext(context: IGraphicContext) {
    this.#interactiveContext = context;
  }

  // ═══════════════════════════════════════════════════════════
  // FONT ENGINE INTEGRATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the FontEngine instance.
   */
  public get fontEngine(): FontEngine {
    return this.#fontEngine;
  }

  /**
   * Start editing a glyph. Creates an edit session in Rust and adds an empty contour.
   */
  public startEditSession(unicode: number): void {
    debug("Starting edit session for unicode:", unicode);
    this.#fontEngine.session.startEditSession(unicode);
    // Add an empty contour to start with
    this.#fontEngine.editing.addContour();
  }

  /**
   * End the current edit session.
   */
  public endEditSession(): void {
    this.#fontEngine.session.endEditSession();
  }

  /**
   * Get the current snapshot from FontEngine.
   */
  public getSnapshot(): GlyphSnapshot | null {
    return this.#fontEngine.snapshot;
  }

  /**
   * Create a ToolContext for modern tools.
   * This is the preferred API for new tools.
   */
  public createToolContext(): ToolContext {
    return {
      snapshot: this.#fontEngine.snapshot,
      selectedPoints: this.#state.selectedPoints,
      hoveredPoint: this.#state.hoveredPoint,
      viewport: this.#viewport,
      mousePosition: this.#viewport.getUpmMousePosition(),
      fontEngine: this.#fontEngine,
      commands: this.#commandHistory,
      setSelectedPoints: (ids) => {
        this.#state.selectedPoints = ids;
        this.requestRedraw();
      },
      addToSelection: (id) => {
        this.#state.selectedPoints.add(id);
        this.requestRedraw();
      },
      clearSelection: () => {
        this.#state.selectedPoints.clear();
        this.requestRedraw();
      },
      setHoveredPoint: (id) => {
        this.#state.hoveredPoint = id;
        this.requestRedraw();
      },
      requestRedraw: () => this.requestRedraw(),
    };
  }

  /**
   * Get the command history for undo/redo operations.
   */
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

  public on<T>(event: EventName, handler: EventHandler<T>) {
    this.#eventEmitter.on(event, handler);
  }

  public off<T>(event: EventName, handler: EventHandler<T>) {
    this.#eventEmitter.off(event, handler);
  }

  public emit<T>(event: EventName, data: T) {
    this.#eventEmitter.emit(event, data);
  }

  public undo() {
    this.#undoManager.undo();
    this.redrawGlyph();
  }

  public setViewportRect(rect: Rect2D) {
    this.#viewport.setRect(rect);
  }

  public setViewportUpm(upm: number) {
    this.#viewport.upm = upm;
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

  public zoom(): number {
    return this.#viewport.zoom;
  }

  /**
   * Get the handle state for a point by ID.
   */
  public getHandleState(pointId: PointId): HandleState {
    if (this.#state.selectedPoints.has(pointId)) {
      return "selected";
    }

    if (this.#state.hoveredPoint === pointId) {
      return "hovered";
    }

    return "idle";
  }

  public paintHandle(
    ctx: IRenderer,
    x: number,
    y: number,
    handleType: HandleType,
    state: HandleState,
    isCounterClockWise?: boolean
  ) {
    switch (handleType) {
      case "first":
        this.#painter.drawFirstHandle(ctx, x, y, state);
        break;
      case "corner":
        this.#painter.drawCornerHandle(ctx, x, y, state);
        break;
      case "control":
        this.#painter.drawControlHandle(ctx, x, y, state);
        break;
      case "smooth":
        this.#painter.drawSmoothHandle(ctx, x, y, state);
        break;
      case "direction":
        this.#painter.drawDirectionHandle(ctx, x, y, state, isCounterClockWise);
        break;
    }
  }

  public invalidateGlyph() {
    this.#scene.invalidateGlyph();
  }

  public getGlyphPath(): Path2D {
    return this.#scene.getGlyphPath();
  }

  /**
   * Set the hovered point by ID.
   */
  public setHoveredPoint(pointId: PointId | null) {
    this.#state.hoveredPoint = pointId;
  }

  public clearHoveredPoint() {
    this.#state.hoveredPoint = null;
  }

  /**
   * Get the currently hovered point ID.
   */
  public get hoveredPoint(): PointId | null {
    return this.#state.hoveredPoint;
  }

  /**
   * Get the selected point IDs.
   */
  public get selectedPoints(): ReadonlySet<PointId> {
    return this.#state.selectedPoints;
  }

  /**
   * Check if a point is selected by ID.
   */
  public isPointSelected(pointId: PointId): boolean {
    return this.#state.selectedPoints.has(pointId);
  }

  /**
   * Add a point to the selection by ID.
   */
  public addToSelection(pointId: PointId): void {
    this.#state.selectedPoints.add(pointId);
  }

  /**
   * Set the selected points.
   */
  public setSelectedPoints(pointIds: Set<PointId>): void {
    this.#state.selectedPoints = pointIds;
  }

  public clearSelectedPoints() {
    this.#state.selectedPoints.clear();
  }

  /**
   * Get point data for all selected points.
   * Used for calculating bounding rectangles.
   */
  #getSelectedPointData(): Array<{ x: number; y: number }> {
    const snapshot = this.#fontEngine.snapshot;
    if (!snapshot) return [];

    const result: Array<{ x: number; y: number }> = [];
    for (const pointId of this.#state.selectedPoints) {
      const found = findPointInSnapshot(snapshot, pointId);
      if (found) {
        result.push({ x: found.point.x, y: found.point.y });
      }
    }
    return result;
  }

  /**
   * Add a point to the active contour via FontEngine.
   * @param x - The x position in UPM coordinates
   * @param y - The y position in UPM coordinates
   * @param pointType - The type of point (onCurve or offCurve)
   * @returns The PointId of the added point
   */
  public addPoint(x: number, y: number, pointType: "onCurve" | "offCurve"): PointId {
    debug("Adding point:", x, y, pointType);
    return this.#fontEngine.editing.addPoint(x, y, pointType, false);
  }

  /**
   * Find a point in the current snapshot by ID.
   */
  public findPoint(pointId: PointId): PointSnapshot | null {
    const snapshot = this.#fontEngine.snapshot;
    if (!snapshot) return null;

    const result = findPointInSnapshot(snapshot, pointId);
    return result?.point ?? null;
  }

  /**
   * Close the active contour via FontEngine.
   */
  public closeContour(): void {
    debug("Closing contour");
    this.#fontEngine.editing.closeContour();
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
      panY + center.y * (1 - zoom)
    );
  }

  #applyUpmTransforms(ctx: IRenderer) {
    ctx.transform(
      1,
      0,
      0,
      -1,
      this.#viewport.padding,
      this.#viewport.logicalHeight - this.#viewport.padding
    );
  }

  public redrawGlyph() {
    this.invalidateGlyph();
    this.requestRedraw();
  }

  public constructGuidesPath(guides: Guides) {
    return this.#scene.constructGuidesPath(guides);
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
    ctx.flush();
  }

  #drawStatic() {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();

    const snapshot = this.#fontEngine.snapshot;
    const glyphPath = this.#scene.getGlyphPath();

    debug("drawStatic: snapshot contours:", snapshot?.contours.length ?? 0);
    debug("drawStatic: glyphPath isEmpty:", glyphPath.isEmpty(), "isClosed:", glyphPath.isClosed(), "commands:", glyphPath.commands.length);

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    ctx.setStyle(GUIDE_STYLES);

    ctx.lineWidth = Math.floor(GUIDE_STYLES.lineWidth / this.#viewport.zoom);
    const guides = this.#scene.getGuidesPath();
    this.#painter.drawGuides(ctx, guides);

    // draw contours
    ctx.setStyle(DEFAULT_STYLES);
    ctx.lineWidth = Math.floor(DEFAULT_STYLES.lineWidth / this.#viewport.zoom);
    debug("drawStatic: about to stroke glyphPath");
    ctx.stroke(glyphPath);
    if (glyphPath.isClosed() && this.#state.fillContour) {
      ctx.fillStyle = "black";
      ctx.fill(glyphPath);
    }

    if (this.#state.selectedPoints.size > 0 && !this.#state.fillContour) {
      // Get the actual point data for selected points to calculate bounding rect
      const selectedPointData = this.#getSelectedPointData();
      if (selectedPointData.length > 0) {
        const bbRect = getBoundingRect(selectedPointData);
        ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
        ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
      }
    }

    ctx.restore();
    ctx.save();

    // Draw handles directly from snapshot
    if (!this.#state.fillContour && snapshot) {
      this.#drawHandlesFromSnapshot(ctx, snapshot);
    }

    ctx.restore();
    ctx.flush();
  }

  /**
   * Draw point handles directly from snapshot data.
   * This is the single source of truth - no intermediate state.
   */
  #drawHandlesFromSnapshot(ctx: IRenderer, snapshot: GlyphSnapshot): void {
    for (const contour of snapshot.contours) {
      const points = contour.points;
      const numPoints = points.length;

      if (numPoints === 0) continue;

      for (let idx = 0; idx < numPoints; idx++) {
        const point = points[idx];
        const { x, y } = this.#viewport.projectUpmToScreen(point.x, point.y);
        const handleState = this.getHandleState(asPointId(point.id));

        // Single point - just draw corner
        if (numPoints === 1) {
          this.paintHandle(ctx, x, y, "corner", handleState);
          continue;
        }

        const isFirst = idx === 0;
        const isLast = idx === numPoints - 1;

        // First point
        if (isFirst) {
          if (contour.closed) {
            // Direction indicator for closed contours
            const clockwise = isContourClockwise(points);
            this.paintHandle(ctx, x, y, "direction", handleState, !clockwise);
          } else {
            // First handle for open contours
            this.paintHandle(ctx, x, y, "first", handleState);
          }
          continue;
        }

        // Last point of open contour
        if (isLast && !contour.closed) {
          const prevPoint = points[idx - 1];
          const { x: px, y: py } = this.#viewport.projectUpmToScreen(
            prevPoint.x,
            prevPoint.y
          );
          this.#painter.drawLastHandle(ctx, x, y, px, py, handleState);
          continue;
        }

        // Regular points
        if (point.pointType === "onCurve") {
          if (point.smooth) {
            this.paintHandle(ctx, x, y, "smooth", handleState);
          } else {
            this.paintHandle(ctx, x, y, "corner", handleState);
          }
        } else {
          // Off-curve (control point)
          // Find the anchor point to draw the handle line
          const nextPoint = points[(idx + 1) % numPoints];
          const prevPoint = points[idx - 1];

          // If next point is also off-curve, connect to previous anchor
          // Otherwise connect to next anchor
          const anchor =
            nextPoint.pointType === "offCurve" ? prevPoint : nextPoint;

          const { x: anchorX, y: anchorY } = this.#viewport.projectUpmToScreen(
            anchor.x,
            anchor.y
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
    if (this.#staticContext) {
      this.#staticContext.destroy();
    }

    if (this.#interactiveContext) {
      this.#interactiveContext.destroy();
    }
  }
}
