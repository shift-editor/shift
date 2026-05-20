import type { PointId } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import type { HoverState } from "@/lib/editor/Hover";
import type { SelectionState } from "@/lib/editor/Selection";
import type { GlyphRenderContour } from "@/lib/model/GlyphRenderModel";
import { PointHandleItem } from "./PointHandleItem";

export interface HandleStateSource {
  readonly selection: SelectionState;
  readonly hover: HoverState;
}

export class HandleDisplayList {
  static readonly empty = new HandleDisplayList([]);

  constructor(readonly items: readonly PointHandleItem[]) {}
}

export class HandleItems {
  readonly #items: PointHandleItem[] = [];
  readonly #pool: PointHandleItem[] = [];

  fromContours(
    contours: readonly GlyphRenderContour[],
    source: HandleStateSource,
  ): HandleDisplayList {
    let itemCount = 0;

    for (const contour of contours) {
      const points = contour.points;
      const count = points.length;
      if (count === 0) continue;

      for (let index = 0; index < count; index++) {
        const point = points[index]!;
        const prev = index > 0 ? points[index - 1]! : contour.closed ? points[count - 1]! : null;
        const next = index + 1 < count ? points[index + 1]! : contour.closed ? points[0]! : null;
        const state = this.#state(point.id, source);
        const item = this.#pool[itemCount];

        if (item) {
          item.reset(point, prev, next, index, count, contour.closed, state);
          this.#items[itemCount] = item;
        } else {
          this.#items[itemCount] = new PointHandleItem(
            point,
            prev,
            next,
            index,
            count,
            contour.closed,
            state,
          );
          this.#pool[itemCount] = this.#items[itemCount]!;
        }
        itemCount++;
      }
    }

    this.#items.length = itemCount;
    return new HandleDisplayList(this.#items);
  }

  #state(pointId: PointId, source: HandleStateSource): HandleState {
    if (source.selection.pointIds.has(pointId)) return "selected";

    if (source.hover?.type === "point" && source.hover.pointId === pointId) return "hovered";

    return "idle";
  }
}
