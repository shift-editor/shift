import AppState from "@/store/store";
import { IGraphicContext } from "@/types/graphics";
import { Tool } from "@/types/tool";

import { Painter } from "./Painter";
import { Scene } from "./Scene";
import { Viewport } from "./Viewport";
import { tools } from "../tools/tools";

export class Editor {
  #viewport: Viewport;
  #scene: Scene;
  #painter: Painter;

  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;

  constructor() {
    this.#viewport = new Viewport();
    this.#scene = new Scene();
    this.#painter = new Painter();

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
}
