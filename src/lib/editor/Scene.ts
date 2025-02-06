import { tools } from "@/lib/tools/tools";
import AppState from "@/store/store";
import { Tool } from "@/types/tool";

import { PathManager } from "./PathManager";

export class Scene {
  #pathManager: PathManager;

  public constructor() {
    this.#pathManager = new PathManager();
  }

  public getPathManager(): PathManager {
    return this.#pathManager;
  }
}
