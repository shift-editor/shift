import { ContourPoint } from "@/lib/core/Contour";
import { Editor } from "@/lib/editor/Editor";
import { UPMRect } from "@/lib/math/rect";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import { IRenderer } from "@/types/graphics";
import { Point2D } from "@/types/math";
import { NUDGES_VALUES } from "@/types/nudge";
import { Tool, ToolName } from "@/types/tool";

export type SelectState =
  | { type: "ready" }
  | { type: "selecting"; startPos: Point2D }
  | {
      type: "modifying";
      selectedPoint?: ContourPoint;
      shiftModifierOn?: boolean;
    };

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

  moveSelectedPoints(dx: number, dy: number): void {
    for (const point of this.#editor.selectedPoints) {
      // if control point is part of a smooth triplet need to handle this
      this.#editor.movePointTo(point.entityId, point.x + dx, point.y + dy);
    }
  }

  commitSelectedPoints(): void {}

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

        if (!this.#editor.isPointSelected(firstHitPoint)) {
          if (this.#state.shiftModifierOn) {
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
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
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
      const dx = x - this.#state.selectedPoint.x;
      const dy = y - this.#state.selectedPoint.y;

      this.moveSelectedPoints(dx, dy);

      this.#editor.redrawContours(
        Array.from(this.#editor.selectedPoints).map((p) => p.entityId),
      );
    }

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);

    if (hitPoints.length > 0) {
      this.#editor.setHoveredPoint(hitPoints[0]);
    } else {
      this.#editor.clearHoveredPoint();
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
  }

  keyDownHandler(e: KeyboardEvent) {
    if (this.#state.type === "modifying") {
      const selectedPointIds = Array.from(this.#editor.selectedPoints).map(
        (p) => p.entityId,
      );

      this.#state.shiftModifierOn = e.shiftKey;
      const modifier = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
      const nudge = NUDGES_VALUES[modifier];

      switch (e.key) {
        case "ArrowLeft":
          this.moveSelectedPoints(-nudge, 0);
          this.#editor.emit("points:moved", selectedPointIds);
          break;
        case "ArrowRight":
          this.moveSelectedPoints(nudge, 0);
          this.#editor.emit("points:moved", selectedPointIds);
          break;
        case "ArrowUp":
          this.moveSelectedPoints(0, nudge);
          this.#editor.emit("points:moved", selectedPointIds);
          break;
        case "ArrowDown":
          this.moveSelectedPoints(0, -nudge);
          this.#editor.emit("points:moved", selectedPointIds);
          break;
      }
    }
  }

  keyUpHandler(_: KeyboardEvent) {
    if (this.#state.type === "modifying") {
      this.#state.shiftModifierOn = false;
    }
  }
}
