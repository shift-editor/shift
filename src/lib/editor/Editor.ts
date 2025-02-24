import { EntityId, Ident } from "@/lib/core/EntityId";
import { EventEmitter } from "@/lib/core/EventEmitter";
import {
  DEFAULT_STYLES,
  GUIDE_STYLES,
  HANDLE_STYLES,
} from "@/lib/styles/style";
import AppState from "@/store/store";
import { Event, EventData, EventHandler } from "@/types/events";
import { IGraphicContext, IRenderer } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";
import { Tool } from "@/types/tool";
import { tools } from "@lib/tools/tools";

import { FrameHandler } from "./FrameHandler";
import { Painter } from "./Painter";
import { Scene } from "./Scene";
import { Viewport } from "./Viewport";

interface EditorState {
  fillContour: boolean;
}

export const InitialEditorState: EditorState = {
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

  public getMousePosition(clientX?: number, clientY?: number): Point2D {
    if (clientX && clientY) {
      return this.#viewport.getMousePosition(clientX, clientY);
    }

    return this.#viewport.getMousePosition();
  }

  public setMousePosition(clientX: number, clientY: number): Point2D {
    return this.#viewport.setMousePosition(clientX, clientY);
  }

  public getUpmMousePosition(clientX?: number, clientY?: number): Point2D {
    if (clientX && clientY) {
      return this.#viewport.getUpmMousePosition(clientX, clientY);
    }

    return this.#viewport.getUpmMousePosition();
  }

  public setUpmMousePosition(clientX: number, clientY: number): Point2D {
    return this.#viewport.setUpmMousePosition(clientX, clientY);
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

  public invalidateContour(id: Ident) {
    this.#scene.invalidateContour(id);
  }

  public addPoint(clientX: number, clientY: number): EntityId {
    const { x, y } = this.getUpmMousePosition(clientX, clientY);
    return this.#scene.addPoint({ x, y });
  }

  public getAllPoints() {
    return this.#scene.getAllPoints();
  }

  public upgradeLineSegment(id: Ident) {
    this.#scene.upgradeLineSegment(id);
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
    ctx.transform(
      1,
      0,
      0,
      -1,
      this.#viewport.padding,
      this.#viewport.logicalHeight - this.#viewport.padding,
    );
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

    const nodes = this.#scene.nodes();

    ctx.clear();
    ctx.save();

    this.#prepareCanvas(ctx);

    ctx.setStyle(GUIDE_STYLES);
    ctx.lineWidth = GUIDE_STYLES.lineWidth / this.#viewport.zoom;
    this.#painter.drawGuides(ctx, this.#scene.getStaticGuidesPath());

    // draw contours
    ctx.setStyle(DEFAULT_STYLES);
    ctx.lineWidth = DEFAULT_STYLES.lineWidth / this.#viewport.zoom;
    for (const node of nodes) {
      ctx.stroke(node.renderPath);
      if (this.#state.fillContour) {
        ctx.fill(node.renderPath);
      }
    }

    ctx.restore();
    ctx.save();

    if (!this.#state.fillContour) {
      for (const node of nodes) {
        const points = node.contour.points();
        for (const point of points) {
          const { x, y } = this.#viewport.projectUpmToScreen(point.x, point.y);

          if (node.contour.closed() && node.contour.firstPoint() === point) {
            ctx.setStyle(HANDLE_STYLES.direction);
            this.#painter.drawDirectionHandle(ctx, x, y);
            continue;
          }

          switch (point.type) {
            case "onCurve":
              ctx.setStyle(HANDLE_STYLES.corner);
              this.#painter.drawCornerHandle(ctx, x, y);
              break;
            case "offCurve":
              ctx.setStyle(HANDLE_STYLES.control);
              this.#painter.drawControlHandle(ctx, x, y);
              break;
          }
        }
      }
    }

    ctx.restore();
    ctx.flush();
  }

  #flush() {
    if (!this.#staticContext || !this.#interactiveContext) return;
    this.#staticContext.getContext().flush();
    this.#interactiveContext.getContext().flush();
  }

  #draw() {
    console.log(this.#scene.getAllContours());
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
