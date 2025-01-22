import { IRenderer } from "../../types/renderer";
import { Tool } from "../../types/tool";
import { drawPath } from "../draw/path";
import { Pen } from "../tools/Pen";
import { CanvasManager } from "./CanvasManager";
import { PathManager } from "./PathManager";

export class Editor {
  #currentTool: Tool = new Pen(this);

  #renderer: IRenderer | null = null;
  private static instance: Editor | null = null;

  #pathManager: PathManager;
  #canvasManager: CanvasManager;

  private constructor(canvas: HTMLCanvasElement) {
    this.#pathManager = new PathManager();
    this.#canvasManager = new CanvasManager(canvas);
  }

  public static initialize(canvas: HTMLCanvasElement): Editor {
    if (!Editor.instance) {
      Editor.instance = new Editor(canvas);
    }
    return Editor.instance;
  }

  public static getInstance(): Editor {
    if (!Editor.instance) {
      throw new Error("Editor not initialized");
    }
    return Editor.instance;
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

  public draw() {
    this.renderer.clear();
    this.renderer.save();

    for (const path of this.pathManager.paths) {
      drawPath(this.renderer, path);
    }

    this.renderer.restore();
    this.renderer.flush();
  }
}
