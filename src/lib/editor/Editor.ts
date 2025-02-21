import { EventEmitter, EventHandler } from "@/lib/core/EventEmitter";
import AppState from "@/store/store";
import { EditorEvent } from "@/types/events";
import { IGraphicContext } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";
import { Tool } from "@/types/tool";
import { tools } from "@lib/tools/tools";

import { FrameHandler } from "./FrameHandler";
import { Painter } from "./Painter";
import { Scene } from "./Scene";
import { Viewport } from "./Viewport";
import { DEFAULT_STYLES, GUIDE_STYLES, HANDLE_STYLES } from "../styles/style";

interface EditorState {
  isSelecting: boolean;
  selectionRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export const InitialEditorState: EditorState = {
  isSelecting: false,
  selectionRect: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  },
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

  public on(event: EditorEvent, handler: EventHandler) {
    this.#eventEmitter.on(event, handler);
  }

  public off(event: EditorEvent, handler: EventHandler) {
    this.#eventEmitter.off(event, handler);
  }

  public emit(event: EditorEvent, ...args: unknown[]) {
    this.#eventEmitter.emit(event, ...args);
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

  public addPoint(clientX: number, clientY: number): void {
    const { x, y } = this.getUpmMousePosition(clientX, clientY);
    this.#scene.addPoint({ x, y });
  }

  public setSelecting(isSelecting: boolean) {
    this.#state.isSelecting = isSelecting;
  }

  public setSelectionRect(x: number, y: number, width: number, height: number) {
    this.#state.selectionRect = { x, y, width, height };
  }

  #draw() {
    if (!this.#staticContext) return;
    const ctx = this.#staticContext.getContext();
    const nodes = this.#scene.getNodes();

    ctx.clear();
    ctx.save();

    const center = this.#viewport.getCentrePoint();
    const zoom = this.#viewport.zoom;
    const { panX, panY } = this.#viewport;

    // TODO: we can transform these coords to UPM and move the after the transforms
    if (this.#state.isSelecting) {
      this.#painter.drawSelectionRectangle(
        ctx,
        this.#state.selectionRect.x,
        this.#state.selectionRect.y,
        this.#state.selectionRect.width,
        this.#state.selectionRect.height,
      );
    }

    ctx.transform(
      zoom,
      0,
      0,
      zoom,
      panX + center.x * (1 - zoom),
      panY + center.y * (1 - zoom),
    );

    ctx.transform(
      1,
      0,
      0,
      -1,
      this.#viewport.padding,
      this.#viewport.logicalHeight - this.#viewport.padding,
    );

    ctx.setStyle(GUIDE_STYLES);
    ctx.lineWidth = GUIDE_STYLES.lineWidth / zoom;
    this.#painter.drawGuides(ctx, this.#scene.getStaticGuidesPath());

    // draw contours
    ctx.setStyle(DEFAULT_STYLES);
    ctx.lineWidth = DEFAULT_STYLES.lineWidth / zoom;
    for (const node of nodes) {
      ctx.stroke(node.renderPath);
    }

    ctx.restore();
    ctx.save();

    // draw handles
    for (const node of nodes) {
      const points = node.contour.points();
      for (const point of points) {
        // 1. Start with UPM coordinates and add padding
        let x = point.x + this.#viewport.padding;
        let y = point.y;

        // 2. Flip Y and apply padding
        y = -(y - (this.#viewport.logicalHeight - this.#viewport.padding));

        // 3. Apply ONLY the pan and center offset (no zoom scaling)
        x = x * zoom + (panX + center.x * (1 - zoom));
        y = y * zoom + (panY + center.y * (1 - zoom));

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

    ctx.flush();
    ctx.restore();
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
