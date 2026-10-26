import { Bounds, type Bounds as BoundsType } from "@shift/geo";
import { type ContourData, type PointId, type SegmentId } from "@shift/types";
import { Contour, type GlyphPosition, type Point, type Segment } from "@shift/glyph-state";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
  track,
} from "../signals/signal";
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
  readonly #coordinates: PackedArray;
  /** Bumped after each in-place change to `#coordinates`; readers track this, not the array. */
  readonly #revision: WritableSignal<number>;
  /** Each point's record index; changes only with the point list, not with coordinates. */
  readonly #pointIndices: ComputedSignal<ReadonlyMap<PointId, number>>;

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
    this.#coordinates = new PackedArray(2, values);
    this.#revision = signal(0, { name: `glyphLayer.contour[${contourIndex}].coordinates` });
    this.#pointIndices = computed(
      () => new Map(this.#dataCell.value.points.map((point, index) => [point.id, index])),
      { name: `glyphLayer.contour[${contourIndex}].pointIndices` },
    );
    this.valuesCell = computed(
      () => {
        track(this.#revision);
        // A fresh view over the same memory, so readers see a new value per revision.
        return this.#coordinates.view;
      },
      {
        name: `glyphLayer.contour[${contourIndex}].values`,
      },
    );
    this.contourCell = computed(() => new Contour(this.#dataCell.value, this.valuesCell.value, 0), {
      name: `glyphLayer.contour[${contourIndex}].geometry`,
    });
    this.pointsCell = computed(() => this.contourCell.value.points, {
      name: `glyphLayer.contour[${contourIndex}].points`,
    });
    this.segmentsCell = computed(() => this.contourCell.value.segments(), {
      name: `glyphLayer.contour[${contourIndex}].segments`,
    });
    // Most drags move points inside the contour's box; equal bounds keep readers from rerunning.
    this.boundsCell = computed(() => this.contourCell.value.bounds, {
      name: `glyphLayer.contour[${contourIndex}].bounds`,
      equals: Bounds.equals,
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
    return this.#pointIndices.peek().get(pointId) ?? -1;
  }

  point(pointId: PointId): Point | null {
    return this.pointsCell.peek().find((point) => point.id === pointId) ?? null;
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.segmentsCell.peek().find((segment) => segment.id === segmentId) ?? null;
  }

  /** Every point's current position, in contour order. */
  get positions(): GlyphPosition[] {
    const coordinates = this.#coordinates;
    return this.data.points.map((point, index) => ({
      kind: "point",
      id: point.id,
      x: coordinates.getComponent(index, 0),
      y: coordinates.getComponent(index, 1),
    }));
  }

  position(pointId: PointId): GlyphPosition | null {
    const index = this.pointIndex(pointId);
    if (index < 0) return null;

    const coordinates = this.#coordinates;
    return {
      kind: "point",
      id: pointId,
      x: coordinates.getComponent(index, 0),
      y: coordinates.getComponent(index, 1),
    };
  }

  patchPositions(updates: readonly GlyphPosition[]): void {
    const coordinates = this.#coordinates;
    let changed = false;
    for (const update of updates) {
      if (update.kind !== "point") continue;

      const pointIndex = this.pointIndex(update.id);
      if (pointIndex < 0) continue;
      changed = coordinates.setItem(pointIndex, [update.x, update.y]) || changed;
    }
    if (changed) this.#markChanged();
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== this.pointCount * 2) {
      throw new RangeError("ContourBuffer replacement must match its points");
    }

    const coordinates = this.#coordinates;
    if (coordinates.replace(values)) this.#markChanged();
  }

  /** Publishes an in-place change to the packed values. */
  #markChanged(): void {
    this.#revision.update((revision) => revision + 1);
  }
}
