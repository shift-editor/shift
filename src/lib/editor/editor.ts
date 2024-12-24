import { IRenderer } from "../../types/renderer";
import { Path } from "../geometry/path";
import { Pen } from "../tools/pen";
import { Tool } from "../tools/tool";
import { CanvasManager } from "./canvas";

export class Editor {
  #currentTool: Tool = new Pen(this);
  #paths: Path[] = [];
  #renderer: IRenderer | null = null;
  #canvasManager: CanvasManager;

  public constructor(canvasRef: React.RefObject<HTMLCanvasElement>) {
    this.#canvasManager = new CanvasManager(canvasRef);
  }

  get currentTool(): Tool {
    return this.#currentTool;
  }

  get canvasManager(): CanvasManager {
    return this.#canvasManager;
  }

  set renderer(renderer: IRenderer) {
    this.#renderer = renderer;
  }

  get paths(): Path[] {
    return this.#paths;
  }

  draw() {
    this.renderer.flush();
  }
}
