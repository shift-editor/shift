import type { AnchorData, AnchorId, AnchorSeed } from "@shift/types";
import { Anchor, type GlyphPosition } from "@shift/glyph-state";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
  track,
} from "../signals/signal";
import { PackedArray } from "./PackedArray";

/** Anchor metadata and its fixed-width packed coordinate records. */
export class AnchorBuffer {
  readonly #dataCell: WritableSignal<readonly AnchorData[]>;
  readonly #coordinates: PackedArray;
  /** Bumped after each in-place change to `#coordinates`; readers track this, not the array. */
  readonly #revision: WritableSignal<number>;

  readonly valuesCell: ComputedSignal<Float64Array>;
  readonly anchorsCell: ComputedSignal<readonly Anchor[]>;

  constructor(data: readonly AnchorData[], values: Float64Array) {
    if (values.length !== data.length * 2) {
      throw new RangeError("AnchorBuffer coordinate count must match its anchors");
    }

    this.#dataCell = signal(data, { name: "glyphLayer.anchors.data" });
    this.#coordinates = new PackedArray(2, values);
    this.#revision = signal(0, { name: "glyphLayer.anchors.coordinates" });
    this.valuesCell = computed(
      () => {
        track(this.#revision);
        // A fresh view over the same memory, so readers see a new value per revision.
        return this.#coordinates.view;
      },
      {
        name: "glyphLayer.anchors.values",
      },
    );
    this.anchorsCell = computed(() => {
      const values = this.valuesCell.value;
      return this.#dataCell.value.map((anchor, index) => new Anchor(anchor, values, index * 2));
    });
  }

  get data(): readonly AnchorData[] {
    return this.#dataCell.peek();
  }

  get dataCell(): Signal<readonly AnchorData[]> {
    return this.#dataCell;
  }

  position(anchorId: AnchorId): GlyphPosition | null {
    const index = this.#dataCell.peek().findIndex((anchor) => anchor.id === anchorId);
    if (index < 0) return null;

    const coordinates = this.#coordinates;
    return {
      kind: "anchor",
      id: anchorId,
      x: coordinates.getComponent(index, 0),
      y: coordinates.getComponent(index, 1),
    };
  }

  add(anchors: readonly AnchorSeed[]): void {
    const data: AnchorData[] = [
      ...this.#dataCell.peek(),
      ...anchors.map((anchor) => ({
        id: anchor.id,
        ...(anchor.name === undefined ? {} : { name: anchor.name }),
      })),
    ];

    batch(() => {
      const coordinates = this.#coordinates;
      coordinates.splice(
        coordinates.length,
        0,
        anchors.flatMap((anchor) => [anchor.x, anchor.y]),
      );
      this.#dataCell.set(data);
      this.#markChanged();
    });
  }

  remove(anchorIds: ReadonlySet<AnchorId>): void {
    const data = this.#dataCell.peek();
    const indexes: number[] = [];
    for (let index = 0; index < data.length; index++) {
      if (anchorIds.has(data[index].id)) indexes.push(index);
    }
    if (indexes.length === 0) return;

    batch(() => {
      const coordinates = this.#coordinates;
      for (let index = indexes.length - 1; index >= 0; index--) {
        coordinates.splice(indexes[index], 1);
      }
      this.#dataCell.set(data.filter((anchor) => !anchorIds.has(anchor.id)));
      this.#markChanged();
    });
  }

  patchPositions(updates: readonly GlyphPosition[]): void {
    const data = this.#dataCell.peek();
    const coordinates = this.#coordinates;
    let changed = false;
    for (const update of updates) {
      if (update.kind !== "anchor") continue;

      const index = data.findIndex((anchor) => anchor.id === update.id);
      if (index < 0) continue;
      changed = coordinates.setItem(index, [update.x, update.y]) || changed;
    }
    if (changed) this.#markChanged();
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== this.#dataCell.peek().length * 2) {
      throw new RangeError("AnchorBuffer replacement must match its anchors");
    }

    const coordinates = this.#coordinates;
    if (coordinates.replace(values)) this.#markChanged();
  }

  /** Publishes an in-place change to the packed values. */
  #markChanged(): void {
    this.#revision.update((revision) => revision + 1);
  }
}
