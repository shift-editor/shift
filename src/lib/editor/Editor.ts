import AppState from "@/store/store";
import { IGraphicContext } from "@/types/graphics";
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
    this.#scene = new Scene();
    this.#painter = new Painter();
    this.#frameHandler = new FrameHandler();

    this.#scene;
    this.#frameHandler;

    this.#staticContext = null;
    this.#interactiveContext = null;
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

  public setMousePosition(x: number, y: number) {
    this.#viewport.setMousePosition(x, y);
  }

  public mousePosition(): { x: number; y: number } {
    return this.#viewport.mousePosition();
  }

  public pan(dx: number, dy: number) {
    this.#viewport.pan(dx, dy);
  }

  public getPan() {
    return { x: this.#viewport.panX, y: this.#viewport.panY };
  }

  public requestRedraw() {
    if (!this.#staticContext) return;

    const ctx = this.#staticContext.getContext();

    ctx.save();
    ctx.clear();

    ctx.scale(this.#viewport.dpr, this.#viewport.dpr);

    ctx.transform(1, 0, 0, 1, this.#viewport.panX, this.#viewport.panY);

    this.#painter.draw(ctx);

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
