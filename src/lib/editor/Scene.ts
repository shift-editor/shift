import { useRef } from "react";
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

export const getScene = () => {
  const sceneRef = useRef<Scene | null>(null);

  const scene = () => {
    if (!sceneRef.current) {
      sceneRef.current = new Scene();
    }
    return sceneRef;
  };

  return scene();
};
