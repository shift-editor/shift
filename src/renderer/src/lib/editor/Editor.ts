import {
  BOUNDING_RECTANGLE_STYLES,
  DEFAULT_STYLES,
  GUIDE_STYLES,
} from "@/lib/styles/style";
import { tools } from "@/lib/tools/tools";
import AppState from "@/store/store";
import { EditSession } from "@/types/edit";
import { EventHandler, EventName, IEventEmitter } from "@/types/events";
import { IGraphicContext, IRenderer } from "@/types/graphics";
import { HandleState, HandleType } from "@/types/handle";
import { Point2D, Rect2D } from "@/types/math";
import { Segment } from "@/types/segments";
import { Tool, ToolContext } from "@/types/tool";
import type { PointId } from "@/types/ids";
import { asPointId } from "@/types/ids";
import type { GlyphSnapshot, PointSnapshot } from "@/types/generated";

import { FrameHandler } from "./FrameHandler";
import { Painter } from "./Painter";
import { Guides, Scene } from "./Scene";
import { Viewport } from "./Viewport";
import { Contour, ContourPoint, PointType } from "../core/Contour";
import { EntityId } from "../core/EntityId";
import { EditEngine, EditContext } from "../core/EditEngine";
import { UndoManager } from "../core/UndoManager";
import { Path2D } from "../graphics/Path";
import { getBoundingRect } from "../math/rect";
import { snapshotToContours } from "../core/RustBridge";
import { FontEngine } from "@/engine";
import { findPointInSnapshot } from "./render";

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

export class Editor {
  #state: EditorState;

  #viewport: Viewport;
  #scene: Scene;
  #painter: Painter;
  #frameHandler: FrameHandler;
  #eventEmitter: IEventEmitter;

  #undoManager: UndoManager;

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

    this.#eventEmitter = eventEmitter;

    this.#staticContext = null;
    this.#interactiveContext = null;

    this.#state = { ...InitialEditorState, selectedPoints: new Set() };

    // Initialize FontEngine (Rust interface)
    this.#fontEngine = new FontEngine();

    // Subscribe to snapshot changes for automatic sync
    this.#fontEngine.onChange((snapshot) => {
      if (snapshot) {
        this.#syncFromSnapshot(snapshot);
      }
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
   * Sync Scene state from a Rust snapshot.
   * TODO: Eventually Scene should render directly from snapshot without Contour objects.
   */
  #syncFromSnapshot(snapshot: GlyphSnapshot): void {
    // Convert snapshot to TypeScript Contour objects for rendering (temporary)
    const contours = snapshotToContours(snapshot);
    this.#scene.loadContours(contours);

    // Set active contour if there is one
    if (snapshot.activeContourId && contours.length > 0) {
      // The last contour is typically the active one
      const lastContour = contours[contours.length - 1];
      if (lastContour) {
        this.#scene.setActiveContour(lastContour.entityId);
      }
    }
  }

  /**
   * Get the current snapshot from FontEngine.
   */
  public getSnapshot(): GlyphSnapshot | null {
    return this.#fontEngine.snapshot;
  }

  /**
   * Create an edit session for tools.
   * Note: This is a compatibility layer that bridges the old ContourPoint-based
   * tool API with the new PointId-based state. Tools will be migrated to use
   * ToolContext directly in Phase 8.
   */
  public editSession(): EditSession {
    // Convert PointId selection to ContourPoint selection for legacy tools
    const getSelectedContourPoints = (): ContourPoint[] => {
      const allPoints = this.#scene.getAllPoints();
      return allPoints.filter((p) => this.#state.selectedPoints.has(asPointId(p.id)));
    };

    // Find the ContourPoint for the hovered PointId
    const getHoveredContourPoint = (): ContourPoint | null => {
      if (!this.#state.hoveredPoint) return null;
      const allPoints = this.#scene.getAllPoints();
      return allPoints.find((p) => p.id === this.#state.hoveredPoint) ?? null;
    };

    const editEngineContext: EditContext = {
      getSelectedPoints: () => new Set(getSelectedContourPoints()),
      movePointTo: (point, x, y) => {
        this.#scene.movePointTo(point.entityId, x, y);
      },
    };

    const editEngine = new EditEngine(editEngineContext);

    return {
      getMousePosition: (x, y) => {
        const position = this.getMousePosition(x, y);
        return this.projectScreenToUpm(position.x, position.y);
      },
      getAllPoints: () => [...this.#scene.getAllPoints()],
      getSelectedPoints: getSelectedContourPoints,
      getHoveredPoint: getHoveredContourPoint,

      setSelectedPoints: (points) => {
        // Convert ContourPoint[] to Set<PointId>
        this.#state.selectedPoints = new Set(points.map((p) => asPointId(p.id)));
      },
      clearSelectedPoints: () => {
        this.#state.selectedPoints.clear();
      },
      setHoveredPoint: (point) => {
        this.#state.hoveredPoint = point ? asPointId(point.id) : null;
      },
      clearHoveredPoint: () => {
        this.#state.hoveredPoint = null;
      },
      preview: (dx, dy) => {
        editEngine.applyEdits(dx, dy);
      },
      commit: (_dx, _dy) => {
        // TODO: Implement commit via FontEngine
      },
      redraw: () => {
        this.redrawGlyph();
      },
    };
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

  public loadContours(contours: Contour[]) {
    this.clearContours();

    const cs = contours.map((contour) => {
      const c = new Contour();
      contour.points.map((p: ContourPoint) => {
      return c.addPoint(p.x, p.y, p.pointType, p.smooth);
      });
      if (contour.closed) {
        c.close();
      }

      return c;
    });

    // this is a hack to ensure that the glyph is not empty
    if (cs.length === 0) {
      const c = new Contour();
      cs.push(c);

      this.#scene.setActiveContour(c.entityId);
    }

    this.#scene.loadContours(cs);
  }

  public clearContours() {
    this.#scene.clearContours();
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
  public addPoint(x: number, y: number, pointType: PointType): PointId {
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
    this.#fontEngine.editing.closeContour();
  }

  public addRect(rect: Rect2D): EntityId {
    const id = this.#scene.addPoint(rect.x, rect.y, "onCurve");
    this.#scene.addPoint(rect.x + rect.width, rect.y, "onCurve");
    this.#scene.addPoint(rect.x + rect.width, rect.y + rect.height, "onCurve");
    this.#scene.addPoint(rect.x, rect.y + rect.height, "onCurve");

    return id;
  }

  public movePointTo(id: EntityId, x: number, y: number) {
    this.#scene.movePointTo(id, x, y);
  }

  public movePointBy(id: EntityId, dx: number, dy: number) {
    this.#scene.movePointBy(id, dx, dy);
  }

  public getAllPoints(): ReadonlyArray<ContourPoint> {
    return this.#scene.getAllPoints();
  }

  public getAllContours(): ReadonlyArray<Contour> {
    return this.#scene.getAllContours();
  }

  public upgradeLineSegment(id: EntityId): EntityId {
    return this.#scene.upgradeLineSegment(id);
  }

  public getSegment(id: EntityId): Segment | undefined {
    return this.#scene.getSegment(id);
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

    const contours = this.#scene.getAllContours();
    const glyphPath = this.#scene.getGlyphPath();

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

    // handles
    if (!this.#state.fillContour) {
      for (const contour of contours) {
        const pointCursor = contour.pointCursor();
        for (const [idx, point] of pointCursor.items.entries()) {
          const { x, y } = this.#viewport.projectUpmToScreen(point.x, point.y);

          const handleState = this.getHandleState(asPointId(point.id));

          if (pointCursor.length === 1) {
            this.paintHandle(ctx, x, y, "corner", handleState);
            continue;
          }

          if (contour.firstPoint() === point) {
            if (contour.closed) {
              this.paintHandle(
                ctx,
                x,
                y,
                "direction",
                handleState,
                contour.isClockwise()
              );
            } else {
              this.paintHandle(ctx, x, y, "first", handleState);
            }

            continue;
          }

          if (!contour.closed && contour.lastPoint() === point) {
            const p2 = pointCursor.moveTo(idx - 1);
            const { x: px, y: py } = this.#viewport.projectUpmToScreen(
              p2.x,
              p2.y
            );

            this.#painter.drawLastHandle(ctx, x, y, px, py, handleState);
            continue;
          }

          switch (point.pointType) {
            case "onCurve":
              if (point.smooth) {
                this.paintHandle(ctx, x, y, "smooth", handleState);
              } else {
                this.paintHandle(ctx, x, y, "corner", handleState);
              }
              break;

            case "offCurve": {
              pointCursor.moveTo(idx);
              const anchor =
                pointCursor.peekNext().pointType == "offCurve"
                  ? pointCursor.prev()
                  : pointCursor.next();

              const { x: anchorX, y: anchorY } =
                this.#viewport.projectUpmToScreen(anchor.x, anchor.y);

              this.paintHandle(ctx, x, y, "control", handleState);

              ctx.setStyle(DEFAULT_STYLES);
              ctx.drawLine(anchorX, anchorY, x, y);
              break;
            }
          }
        }
      }
    }

    ctx.restore();
    ctx.flush();
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
