import { IRenderer } from "../../types/renderer";
import { Pen } from "../tools/pen";
import { Tool } from "../tools/tool";
import { CanvasManager } from "./CanvasManager";
import { PathManager } from "./PathManager";

export class Editor {
  #currentTool: Tool = new Pen(this);

  #renderer: IRenderer | null = null;

  #pathManager: PathManager;
  #canvasManager: CanvasManager;

  public constructor(canvasRef: React.RefObject<HTMLCanvasElement>) {
    this.#pathManager = new PathManager();
    this.#canvasManager = new CanvasManager(canvasRef);
  }

  get currentTool(): Tool {
    return this.#currentTool;
  }

  get canvasManager(): CanvasManager {
    return this.#canvasManager;
  }

  get pathManager(): PathManager {
    return this.#pathManager;
  }

  set renderer(renderer: IRenderer) {
    this.#renderer = renderer;
  }

  get renderer(): IRenderer {
    if (!this.#renderer) {
      throw new Error("no renderer available");
    }
    return this.#renderer;
  }

  draw() {
    
  }
}
