import { Rect, type Rect2D } from "@shift/geo";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Select } from "./Select";

export class SelectMarquee extends CanvasItem<Rect2D> {
  readonly #select: Select;

  constructor(select: Select) {
    super();
    this.#select = select;
  }

  protected props(): Rect2D | null {
    const state = this.#select.stateCell.value;
    if (state.type !== "brushing") return null;

    return Rect.fromPoints(state.selection.startPos, state.selection.currentPos);
  }

  draw(canvas: Canvas): void {
    const rect = this.propsCell.value;
    if (!rect) return;

    canvas.fillRect(rect.x, rect.y, rect.width, rect.height, canvas.theme.selection.fill);
    canvas.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      canvas.theme.selection.stroke,
      canvas.theme.selection.widthPx,
    );
  }
}
