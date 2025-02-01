import AppState from "../../store/store";
import { Tool } from "../../types/tool";
import { tools } from "../tools/tools";
import { PathManager } from "./PathManager";

export class Scene {
  #pathManager: PathManager;

  public constructor() {
    this.#pathManager = new PathManager();
  }

  public getPathManager(): PathManager {
    return this.#pathManager;
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
