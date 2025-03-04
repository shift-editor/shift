import { ContourPoint } from "@/lib/core/Contour";
import { Editor } from "@/lib/editor/Editor";
import { UPMRect } from "@/lib/math/rect";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import { IRenderer } from "@/types/graphics";
import { Point2D } from "@/types/math";
import { Tool, ToolName } from "@/types/tool";

export type SelectState =
  | { type: "ready" }
  | { type: "selecting"; startPos: Point2D }
  | { type: "modifying"; selectedPoint?: ContourPoint; multiSelect?: boolean };

export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #state: SelectState;
  #selectionRect: UPMRect;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#state = { type: "ready" };
    this.#selectionRect = new UPMRect(0, 0, 0, 0);
  }

  gatherHitPoints(hitTest: (p: ContourPoint) => boolean): ContourPoint[] {
    return this.#editor.getAllPoints().filter(hitTest);
  }

  commitHitPoints(hitPoints: ContourPoint[]): void {
    hitPoints.map((p) => this.#editor.addToSelectedPoints(p));
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    // TODO:  this could return multiple values if the points are very close
    //        we need to think about how to handle this
    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);
    const firstHitPoint = hitPoints[0];

    switch (this.#state.type) {
      case "ready":
        if (hitPoints.length === 1) {
          this.#state = { type: "modifying", selectedPoint: firstHitPoint };
          this.commitHitPoints(hitPoints);
          break;
        }

        this.#state = { type: "selecting", startPos: { x, y } };
        break;
      case "modifying":
        if (hitPoints.length === 0) {
          this.#state = { type: "ready" };
          this.#editor.clearSelectedPoints();
          break;
        }

        if (!this.#editor.selectedPoints.has(firstHitPoint)) {
          if (this.#state.multiSelect) {
            this.commitHitPoints(hitPoints);
          } else {
            this.#editor.clearSelectedPoints();
            this.commitHitPoints(hitPoints);
          }
        }

        this.#state.selectedPoint = firstHitPoint;
        break;
    }

    this.#editor.requestRedraw();
    // TODO: move bounding box rect to editor
    // const {
    //   x: bbX,
    //   y: bbY,
    //   width,
    //   height,
    // } = getBoundingRectPoints(Array.from(this.#editor.selectedPoints));
    //
    // this.#boundingRect.reposition(bbX, bbY);
    // this.#boundingRect.resize(width, height);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state.type === "selecting") {
      const hitPoints = this.gatherHitPoints((p) =>
        this.#selectionRect.hit(p.x, p.y),
      );

      if (hitPoints.length === 0) {
        this.#state = { type: "ready" };
      } else {
        this.commitHitPoints(hitPoints);
        this.#state = { type: "modifying" };
      }

      this.#selectionRect.clear();
    }

    if (this.#state.type === "modifying") {
      this.#state.selectedPoint = undefined;
    }

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    if (this.#state.type === "selecting") {
      const width = x - this.#state.startPos.x;
      const height = y - this.#state.startPos.y;

      this.#selectionRect.changeOrigin(
        this.#state.startPos.x,
        this.#state.startPos.y,
      );
      this.#selectionRect.resize(width, height);
    }

    // move the point, if it's an active handle move all points by delta
    // otherwise we need to move proportional to an anchor point
    if (this.#state.type === "modifying" && this.#state.selectedPoint) {
      this.#editor.movePointTo(this.#state.selectedPoint.entityId, x, y);
      this.#editor.redrawContour(this.#state.selectedPoint.entityId);
    }

    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    switch (this.#state.type) {
      case "selecting":
        ctx.setStyle({
          ...SELECTION_RECTANGLE_STYLES,
          strokeStyle: "transparent",
        });
        ctx.fillRect(
          this.#selectionRect.x,
          this.#selectionRect.y,
          this.#selectionRect.width,
          this.#selectionRect.height,
        );

        ctx.setStyle({
          ...SELECTION_RECTANGLE_STYLES,
          fillStyle: "transparent",
        });
        ctx.strokeRect(
          this.#selectionRect.x,
          this.#selectionRect.y,
          this.#selectionRect.width,
          this.#selectionRect.height,
        );
        break;
    }
    // ctx.setStyle({
    //   ...BOUNDING_RECTANGLE_STYLES,
    //   fillStyle: "transparent",
    // });
    // ctx.strokeRect(
    //   this.#boundingRect.x,
    //   this.#boundingRect.y,
    //   this.#boundingRect.width,
    //   this.#boundingRect.height,
    // );
  }

  keyDownHandler(e: KeyboardEvent) {
    if (this.#state.type === "modifying" && e.shiftKey) {
      this.#state.multiSelect = true;
    }
  }

  keyUpHandler(_: KeyboardEvent) {
    if (this.#state.type === "modifying") {
      this.#state.multiSelect = false;
    }
  }
}
