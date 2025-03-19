import { IContour, IContourPoint, PointType } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { EventEmitter } from '@/lib/core/EventEmitter';
import { BOUNDING_RECTANGLE_STYLES, DEFAULT_STYLES, GUIDE_STYLES } from '@/lib/styles/style';
import { tools } from '@/lib/tools/tools';
import AppState from '@/store/store';
import { Event, EventData, EventHandler } from '@/types/events';
import { IGraphicContext, IRenderer } from '@/types/graphics';
import { HandleState, HandleType } from '@/types/handle';
import { Point2D, Rect2D } from '@/types/math';
import { CubicSegment } from '@/types/segments';
import { Tool } from '@/types/tool';

import { FrameHandler } from './FrameHandler';
import { Painter } from './Painter';
import { Guides, Scene } from './Scene';
import { Viewport } from './Viewport';
import { Contour, ContourPoint } from '../core/Contour';
import { getBoundingRect } from '../math/rect';

interface EditorState {
  selectedPoints: Set<ContourPoint>;
  hoveredPoint: ContourPoint | null;
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
  #eventEmitter: EventEmitter;

  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;

  constructor() {
    this.#viewport = new Viewport();
    this.#painter = new Painter();

    this.#scene = new Scene();
    this.#frameHandler = new FrameHandler();

    this.#eventEmitter = new EventEmitter();

    this.#staticContext = null;
    this.#interactiveContext = null;

    this.#state = InitialEditorState;
  }

  public setStaticContext(context: IGraphicContext) {
    this.#staticContext = context;
  }

  public setInteractiveContext(context: IGraphicContext) {
    this.#interactiveContext = context;
  }

  public activeTool(): Tool {
    const activeTool = AppState.getState().activeTool;
    const tool = tools.get(activeTool);
    if (!tool) {
      throw new Error(`Tool ${activeTool} not found`);
    }
    return tool.tool;
  }

  public on<E extends Event>(event: E, handler: EventHandler) {
    this.#eventEmitter.on(event, handler);
  }

  public off<E extends Event>(event: E, handler: EventHandler<E>) {
    this.#eventEmitter.off(event, handler);
  }

  public emit<E extends Event>(event: E, data: EventData[E]) {
    this.#eventEmitter.emit(event, data);
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

  public getHandleState(p: ContourPoint): HandleState {
    if (this.#state.selectedPoints.has(p)) {
      return 'selected';
    }

    if (this.#state.hoveredPoint === p) {
      return 'hovered';
    }

    return 'idle';
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
      case 'first':
        this.#painter.drawFirstHandle(ctx, x, y, state);
        break;
      case 'corner':
        this.#painter.drawCornerHandle(ctx, x, y, state);
        break;
      case 'control':
        this.#painter.drawControlHandle(ctx, x, y, state);
        break;
      case 'smooth':
        break;
      case 'direction':
        this.#painter.drawDirectionHandle(ctx, x, y, state, isCounterClockWise);
        break;
    }
  }

  public loadContours(contours: IContour[]) {
    const cs = contours.map((contour) => {
      const c = new Contour();
      contour.points.map((p: IContourPoint) => {
        return c.addPoint(p.x, p.y, p.pointType, p.smooth);
      });
      if (contour.closed) {
        c.close();
      }

      return c;
    });

    this.#scene.loadContours(cs);
  }

  public invalidateContour(id: Ident) {
    this.#scene.invalidateContour(id);
  }

  public setHoveredPoint(point: ContourPoint) {
    this.#state.hoveredPoint = point;
  }

  public clearHoveredPoint() {
    this.#state.hoveredPoint = null;
  }

  public get selectedPoints(): ContourPoint[] {
    return [...this.#state.selectedPoints.values()];
  }

  public isPointSelected(p: ContourPoint) {
    return this.#state.selectedPoints.has(p);
  }

  public addToSelectedPoints(p: ContourPoint) {
    return this.#state.selectedPoints.add(p);
  }

  public clearSelectedPoints() {
    this.#state.selectedPoints.clear();
  }

  // **
  // Add a point to the scene
  // @param x - The screen x position of the point in the viewport
  // @param y - The screen y position of the point in the viewport
  // @returns The id of the point
  // **
  public addPoint(x: number, y: number, pointType: PointType): EntityId {
    return this.#scene.addPoint(x, y, pointType);
  }

  public closeContour(): EntityId {
    return this.#scene.closeContour();
  }

  public addRect(rect: Rect2D): EntityId {
    const id = this.#scene.addPoint(rect.x, rect.y, 'onCurve');
    this.#scene.addPoint(rect.x + rect.width, rect.y, 'onCurve');
    this.#scene.addPoint(rect.x + rect.width, rect.y + rect.height, 'onCurve');
    this.#scene.addPoint(rect.x, rect.y + rect.height, 'onCurve');

    return id;
  }

  public movePointTo(id: EntityId, x: number, y: number) {
    this.#scene.movePointTo({ x, y }, id);
  }

  public getAllPoints(): ReadonlyArray<ContourPoint> {
    return this.#scene.getAllPoints();
  }

  public upgradeLineSegment(id: EntityId): EntityId {
    return this.#scene.upgradeLineSegment(id);
  }

  public getCubicSegment(id: EntityId): CubicSegment | undefined {
    return this.#scene.getCubicSegment(id);
  }

  public setFillContour(fillContour: boolean) {
    this.#state.fillContour = fillContour;
  }

  #applyUserTransforms(ctx: IRenderer) {
    const center = this.#viewport.getCentrePoint();
    const zoom = this.#viewport.zoom;
    const { panX, panY } = this.#viewport;

    ctx.transform(zoom, 0, 0, zoom, panX + center.x * (1 - zoom), panY + center.y * (1 - zoom));
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

  public redrawContours(ids: EntityId[]) {
    for (const id of ids) {
      this.invalidateContour(id.parentId);
    }
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
      ctx.lineWidth = Math.floor(ctx.lineWidth / this.#viewport.zoom);
      tool.drawInteractive(ctx);
    }

    ctx.restore();
    ctx.flush();
  }

  #drawStatic() {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();

    const nodes = this.#scene.nodes();

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    ctx.setStyle(GUIDE_STYLES);

    ctx.lineWidth = Math.floor(GUIDE_STYLES.lineWidth / this.#viewport.zoom);
    const guides = this.#scene.getGuidesPath();
    this.#painter.drawGuides(ctx, guides);

    // draw contours
    ctx.setStyle(DEFAULT_STYLES);
    ctx.lineWidth = Math.floor(ctx.lineWidth / this.#viewport.zoom);
    for (const node of nodes) {
      ctx.stroke(node.renderPath);
      if (this.#state.fillContour && node.contour.closed) {
        ctx.fillStyle = 'black';
        ctx.fill(node.renderPath);
      }
    }

    if (this.#state.selectedPoints.size > 0 && !this.#state.fillContour) {
      const bbRect = getBoundingRect([...this.selectedPoints.values()]);
      ctx.setStyle(BOUNDING_RECTANGLE_STYLES);
      ctx.strokeRect(bbRect.x, bbRect.y, bbRect.width, bbRect.height);
    }

    ctx.restore();
    ctx.save();

    // handles
    if (!this.#state.fillContour) {
      for (const node of nodes) {
        const points = node.contour.points;
        for (const [idx, point] of points.entries()) {
          const { x, y } = this.#viewport.projectUpmToScreen(point.x, point.y);

          const handleState = this.getHandleState(point);

          if (points.length === 1) {
            this.paintHandle(ctx, x, y, 'corner', handleState);
            continue;
          }

          if (node.contour.firstPoint() === point) {
            if (node.contour.closed) {
              this.paintHandle(ctx, x, y, 'direction', handleState, node.contour.isClockwise());
            } else {
              this.paintHandle(ctx, x, y, 'first', handleState);
            }

            continue;
          }

          if (!node.contour.closed && node.contour.lastPoint() === point) {
            const p2 = points[idx - 1];
            const { x: px, y: py } = this.#viewport.projectUpmToScreen(p2.x, p2.y);

            this.#painter.drawLastHandle(ctx, x, y, px, py, handleState);
            continue;
          }

          switch (point.pointType) {
            case 'onCurve':
              this.paintHandle(ctx, x, y, 'corner', handleState);
              break;

            case 'offCurve': {
              const anchor =
                points[idx + 1].pointType == 'offCurve' ? points[idx - 1] : points[idx + 1];

              const { x: anchorX, y: anchorY } = this.#viewport.projectUpmToScreen(
                anchor.x,
                anchor.y
              );

              this.paintHandle(ctx, x, y, 'control', handleState);

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
