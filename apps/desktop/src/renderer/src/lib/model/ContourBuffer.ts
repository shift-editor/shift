import type { Bounds as BoundsType } from "@shift/geo";
import type { ContourData, PointId, PointSeed } from "@shift/types";
import {
  Contour,
  type GlyphPosition,
  Point,
  type Segment,
  type SegmentId,
} from "@shift/glyph-state";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";
import { PackedArray } from "./PackedArray";

/**
 * One logical contour and its packed coordinates.
 *
 * Point metadata and coordinate records have one owner so structural edits
 * cannot update one representation without the other. Consumers may read the
 * derived cells, but layout arithmetic stays inside this class and
 * {@link PackedArray}.
 */
export class ContourBuffer {
  readonly #dataCell: WritableSignal<ContourData>;
  readonly #coordinatesCell: WritableSignal<PackedArray>;

  readonly valuesCell: ComputedSignal<Float64Array>;
  readonly contourCell: ComputedSignal<Contour>;
  readonly pointsCell: ComputedSignal<readonly Point[]>;
  readonly segmentsCell: ComputedSignal<readonly Segment[]>;
  readonly boundsCell: ComputedSignal<BoundsType | null>;

  constructor(data: ContourData, values: Float64Array, contourIndex: number) {
    if (values.length !== data.points.length * 2) {
      throw new RangeError("ContourBuffer coordinate count must match its points");
    }

    this.#dataCell = signal(data, {
      name: `glyphLayer.contour[${contourIndex}].data`,
    });
    this.#coordinatesCell = signal(new PackedArray(2, values), {
      equals: () => false,
      name: `glyphLayer.contour[${contourIndex}].coordinates`,
    });
    this.valuesCell = computed(() => this.#coordinatesCell.value.view, {
      name: `glyphLayer.contour[${contourIndex}].values`,
    });
    this.contourCell = computed(() => new Contour(this.#dataCell.value, this.valuesCell.value, 0), {
      name: `glyphLayer.contour[${contourIndex}].geometry`,
    });
    this.pointsCell = computed(() => this.contourCell.value.points, {
      name: `glyphLayer.contour[${contourIndex}].points`,
    });
    this.segmentsCell = computed(() => this.contourCell.value.segments(), {
      name: `glyphLayer.contour[${contourIndex}].segments`,
    });
    this.boundsCell = computed(() => this.contourCell.value.bounds, {
      name: `glyphLayer.contour[${contourIndex}].bounds`,
    });
  }

  get data(): ContourData {
    return this.#dataCell.peek();
  }

  get dataCell(): Signal<ContourData> {
    return this.#dataCell;
  }

  get pointCount(): number {
    return this.#dataCell.peek().points.length;
  }

  pointIndex(pointId: PointId): number {
    return this.#dataCell.peek().points.findIndex((point) => point.id === pointId);
  }

  point(pointId: PointId): Point | null {
    return this.pointsCell.peek().find((point) => point.id === pointId) ?? null;
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.segmentsCell.peek().find((segment) => segment.id === segmentId) ?? null;
  }

  position(pointId: PointId): GlyphPosition | null {
    const index = this.pointIndex(pointId);
    if (index < 0) return null;

    const coordinates = this.#coordinatesCell.peek();
    return {
      kind: "point",
      id: pointId,
      x: coordinates.getComponent(index, 0),
      y: coordinates.getComponent(index, 1),
    };
  }

  insertPoints(points: readonly PointSeed[], before?: PointId): boolean {
    const data = this.#dataCell.peek();
    const pointIndex = before
      ? data.points.findIndex((point) => point.id === before)
      : data.points.length;
    if (pointIndex < 0) return false;

    const additions = points.map((point) => ({
      id: point.id,
      pointType: point.pointType,
      smooth: point.smooth,
    }));
    const next: ContourData = {
      ...data,
      points: [...data.points.slice(0, pointIndex), ...additions, ...data.points.slice(pointIndex)],
    };

    batch(() => {
      const coordinates = this.#coordinatesCell.peek();
      coordinates.splice(
        pointIndex,
        0,
        points.flatMap((point) => [point.x, point.y]),
      );
      this.#dataCell.set(next);
      this.#coordinatesCell.set(coordinates);
    });
    return true;
  }

  removePoints(pointIds: ReadonlySet<PointId>): void {
    const data = this.#dataCell.peek();
    const indexes: number[] = [];
    for (let index = 0; index < data.points.length; index++) {
      if (pointIds.has(data.points[index].id)) indexes.push(index);
    }
    if (indexes.length === 0) return;

    const points = data.points.filter((point) => !pointIds.has(point.id));
    batch(() => {
      const coordinates = this.#coordinatesCell.peek();
      for (let index = indexes.length - 1; index >= 0; index--) {
        coordinates.splice(indexes[index], 1);
      }
      this.#dataCell.set({ ...data, points });
      this.#coordinatesCell.set(coordinates);
    });
  }

  setClosed(closed: boolean): void {
    const data = this.#dataCell.peek();
    this.#dataCell.set({ ...data, closed });
  }

  setPointSmooth(pointId: PointId, smooth: boolean): boolean {
    const data = this.#dataCell.peek();
    const pointIndex = data.points.findIndex((point) => point.id === pointId);
    if (pointIndex < 0) return false;

    const points = [...data.points];
    points[pointIndex] = { ...points[pointIndex], smooth };
    this.#dataCell.set({ ...data, points });
    return true;
  }

  reverse(): void {
    const data = this.#dataCell.peek();

    batch(() => {
      const coordinates = this.#coordinatesCell.peek();
      coordinates.reverse();
      this.#dataCell.set({ ...data, points: [...data.points].reverse() });
      this.#coordinatesCell.set(coordinates);
    });
  }

  setContourStart(pointId: PointId): boolean {
    const data = this.#dataCell.peek();
    if (!data.closed) return false;

    const index = this.pointIndex(pointId);
    if (index <= 0 || !Point.isOnCurve(data.points[index])) return false;

    const points = [...data.points.slice(index), ...data.points.slice(0, index)];
    const coordinates = this.#coordinatesCell.peek();
    const values: number[] = [];
    for (let offset = 0; offset < points.length; offset++) {
      const next = (index + offset) % points.length;
      values.push(coordinates.getComponent(next, 0), coordinates.getComponent(next, 1));
    }

    batch(() => {
      coordinates.replace(new Float64Array(values));
      this.#dataCell.set({ ...data, points });
      this.#coordinatesCell.set(coordinates);
    });
    return true;
  }

  patchPositions(updates: readonly GlyphPosition[]): void {
    const coordinates = this.#coordinatesCell.peek();
    let changed = false;
    for (const update of updates) {
      if (update.kind !== "point") continue;

      const pointIndex = this.pointIndex(update.id);
      if (pointIndex < 0) continue;
      changed = coordinates.setItem(pointIndex, [update.x, update.y]) || changed;
    }
    if (changed) this.#coordinatesCell.set(coordinates);
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== this.pointCount * 2) {
      throw new RangeError("ContourBuffer replacement must match its points");
    }

    const coordinates = this.#coordinatesCell.peek();
    if (coordinates.replace(values)) this.#coordinatesCell.set(coordinates);
  }
}
