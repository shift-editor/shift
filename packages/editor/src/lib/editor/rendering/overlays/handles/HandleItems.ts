import type { PointId, ContourId } from "@shift/types";
import { Bounds, type Bounds as BoundsType } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { SelectableId } from "../../../../../types/object";
import type { HandleState } from "../../../../../types/graphics";
import type { Hover } from "../../../Hover";
import type { Selection } from "../../../Selection";
import type { GlyphRenderContour } from "../../../../../types/glyphRender";
import { nextPoint, previousPoint } from "../contourNeighbors";
import { PointHandleItem } from "./PointHandleItem";

/** Where the standard metric lines are drawn: these heights, from x = 0 to the advance. */
export interface MetricLineExtent {
  readonly heights: ReadonlySet<number>;
  readonly advance: number;
}

export interface HandleStateSource {
  readonly selection: Selection;
  readonly hover: Hover;
  readonly interpolated?: boolean;
  /** Metric lines; on-curve points lying exactly on one, within its drawn extent, are flagged. */
  readonly metricLines?: MetricLineExtent;
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
    isVisible?: (pointId: PointId, contourId: ContourId) => boolean,
    visibleBounds?: BoundsType,
  ): HandleDisplayList {
    return this.#fromShapes(
      contours,
      (contourIndex, pointIndex) => {
        const contour = contours[contourIndex]!;
        return this.#state(contour.points[pointIndex]!.id, contour.id, source);
      },
      (point) => Point.isOnCurve(point) && onMetricLine(point, source.metricLines),
      isVisible,
      visibleBounds,
    );
  }

  #fromShapes(
    contours: readonly GlyphRenderContour[],
    stateForPoint: (contourIndex: number, pointIndex: number) => HandleState,
    onMetric: (point: Point) => boolean,
    isVisible?: (pointId: PointId, contourId: ContourId) => boolean,
    visibleBounds?: BoundsType,
  ): HandleDisplayList {
    let itemCount = 0;

    for (let contourIndex = 0; contourIndex < contours.length; contourIndex += 1) {
      const contour = contours[contourIndex]!;
      const points = contour.points;
      const count = points.length;
      if (count === 0) continue;

      for (let index = 0; index < count; index++) {
        const point = points[index]!;
        if (visibleBounds && !Bounds.containsPoint(visibleBounds, point)) continue;
        if (isVisible && !isVisible(point.id, contour.id)) continue;

        const prev = previousPoint(points, index, contour.closed);
        const next = nextPoint(points, index, contour.closed);
        const state = stateForPoint(contourIndex, index);
        const metric = onMetric(point);
        const item = this.#pool[itemCount];

        if (item) {
          item.reset(point, prev, next, index, count, contour.closed, state, metric);
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
            metric,
          );
          this.#pool[itemCount] = this.#items[itemCount]!;
        }
        itemCount++;
      }
    }

    this.#items.length = itemCount;
    return new HandleDisplayList(this.#items);
  }

  #state(id: SelectableId, contourId: ContourId, source: HandleStateSource): HandleState {
    if (source.interpolated) return "interpolated";

    // A selected contour covers its points, so they draw as selected too.
    if (source.selection.has(id) || source.selection.has(contourId)) return "selected";

    if (source.hover.has(id)) return "hovered";

    return "idle";
  }
}

function onMetricLine(point: Point, lines: MetricLineExtent | undefined): boolean {
  if (!lines?.heights.has(point.y)) return false;
  return point.x >= 0 && point.x <= lines.advance;
}
