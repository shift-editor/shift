import AppState from "../../store/store";
import { Tool } from "../../types/tool";
import { tools } from "../tools/tools";
import { PathManager } from "./PathManager";

export class Scene {
  #pathManager: PathManager;
  #width: number = 0;
  #height: number = 0;

  public constructor() {
    this.#pathManager = new PathManager();
  }

  public getPathManager(): PathManager {
    return this.#pathManager;
  }

  public get width(): number {
    return this.#width;
  }

  public get height(): number {
    return this.#height;
  }

  public set width(width: number) {
    if (width < 0) {
      throw new Error("Width cannot be negative");
    }

    this.#width = width;
  }

  public set height(height: number) {
    if (height < 0) {
      throw new Error("Height cannot be negative");
    }

    this.#height = height;
  }

  public activeTool(): Tool {
    const activeTool = AppState.getState().activeTool;
    const tool = tools.get(activeTool);
    if (!tool) {
      throw new Error(`Tool ${activeTool} not found`);
    }

    return tool;
  }
}
