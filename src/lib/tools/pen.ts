import { Tool, ToolName } from "../../types/tool";
import { Editor } from "../editor/Editor";
import { Point } from "../geometry/point";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #isMousedDown: boolean = false;
  #rafId: number | null = null;
  #startTime: number | undefined;
  #lastPosition: Point | null = null;

  public constructor(public editor: Editor) {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
    this.#isMousedDown = true;
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#isMousedDown = false;
    const p = this.editor.canvasManager.getRelativePosition(e);

    this.editor.pathManager.addPoint(p);
    this.editor.draw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#isMousedDown) return;

    // Cancel any pending frame
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    // Always store the latest position
    this.#lastPosition = this.editor.canvasManager.getRelativePosition(e);

    // Only schedule a new frame if we don't have one pending
    this.#rafId = requestAnimationFrame((timestamp) => {
      // Initialize start time on first frame
      if (this.#startTime === undefined) {
        this.#startTime = timestamp;
      }

      if (this.#lastPosition) {
        const lastPoint = this.editor.pathManager.currentPath.lastPoint;
        lastPoint.set_x(this.#lastPosition.x);
        lastPoint.set_y(this.#lastPosition.y);

        this.editor.draw();
      }
      this.#rafId = null;
    });
  }
}
