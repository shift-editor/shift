import type { SelectableId } from "@/types";
import type { HandleState } from "@/types/graphics";
import type { Hover } from "@/lib/editor/Hover";
import type { Selection } from "@/lib/editor/Selection";
import type { GlyphRenderContour, GlyphRenderContourShape } from "@/types/glyphRender";
import { PointHandleItem } from "./PointHandleItem";

export interface HandleStateSource {
  readonly selection: Selection;
  readonly hover: Hover;
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
    return this.#fromShapes(contours, (contourIndex, pointIndex) =>
      this.#state(contours[contourIndex]!.points[pointIndex]!.id, source),
    );
  }

  fromShapes(contours: readonly GlyphRenderContourShape[]): HandleDisplayList {
    return this.#fromShapes(contours, () => "idle");
  }

  #fromShapes(
    contours: readonly GlyphRenderContourShape[],
    stateForPoint: (contourIndex: number, pointIndex: number) => HandleState,
  ): HandleDisplayList {
    let itemCount = 0;

    for (let contourIndex = 0; contourIndex < contours.length; contourIndex += 1) {
      const contour = contours[contourIndex]!;
      const points = contour.points;
      const count = points.length;
      if (count === 0) continue;

      for (let index = 0; index < count; index++) {
        const point = points[index]!;
        const prev = index > 0 ? points[index - 1]! : contour.closed ? points[count - 1]! : null;
        const next = index + 1 < count ? points[index + 1]! : contour.closed ? points[0]! : null;
        const state = stateForPoint(contourIndex, index);
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

  #state(id: SelectableId, source: HandleStateSource): HandleState {
    if (source.selection.has(id)) return "selected";

    if (source.hover.has(id)) return "hovered";

    return "idle";
  }
}
