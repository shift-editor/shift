import AppState from "@/store/store";
import { IGraphicContext } from "@/types/graphics";
import { Point2D } from "@/types/math";
import { Tool } from "@/types/tool";
import { tools } from "@lib/tools/tools";

import { FrameHandler } from "./FrameHandler";
import { Painter } from "./Painter";
import { Scene } from "./Scene";
import { Viewport } from "./Viewport";

export class Editor {
  #viewport: Viewport;
  #scene: Scene;
  #painter: Painter;
  #frameHandler: FrameHandler;

  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;

  constructor() {
    this.#viewport = new Viewport();
    this.#painter = new Painter();

    this.#scene = new Scene();
    this.#frameHandler = new FrameHandler();

    this.#scene;
    this.#frameHandler;

    this.#staticContext = null;
    this.#interactiveContext = null;
  }

  public setStaticContext(context: IGraphicContext) {
    this.#staticContext = context;

    this.#painter.setStaticGuides(this.#staticContext.getContext());
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

  public setDimensions(width: number, height: number) {
    this.#viewport.setDimensions(width, height);
  }

  public setMousePosition(x: number, y: number) {
    this.#viewport.setMousePosition(x, y);
  }

  public mousePosition(): Point2D {
    return this.#viewport.mousePosition();
  }

  public getUpmPosition(): Point2D {
    return {
      x: this.#viewport.mousePosition().x / this.#viewport.zoom,
      y: this.#viewport.mousePosition().y / this.#viewport.zoom,
    };
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

  applyUserTransforms(): void {
    if (!this.#staticContext || !this.#interactiveContext) return;
    const ctx = this.#staticContext.getContext();

    const centrePoint = this.#viewport.getCentrePoint();
    ctx.translate(centrePoint.x, centrePoint.y);
    ctx.scale(this.#viewport.zoom, this.#viewport.zoom);
    ctx.translate(-centrePoint.x, -centrePoint.y);

    ctx.translate(this.#viewport.panX, this.#viewport.panY);
  }

  public requestRedraw() {
    if (!this.#staticContext) return;

    const ctx = this.#staticContext.getContext();

    ctx.save();

    this.applyUserTransforms();

    ctx.clear();

    ctx.scale(1, -1);
    ctx.translate(0, -this.#viewport.logicalHeight);
    ctx.translate(this.#viewport.padding, this.#viewport.padding);

    this.#painter.drawStatic(ctx);

    ctx.fillStyle = "red";
    ctx.fillCircle(0, 0, 10);

    ctx.flush();

    ctx.restore();
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
