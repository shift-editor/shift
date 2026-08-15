import type { AnchorData, AnchorId, AnchorSeed } from "@shift/types";
import { Anchor, type GlyphPosition } from "@shift/glyph-state";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";
import { PackedArray } from "./PackedArray";

/** Anchor metadata and its fixed-width packed coordinate records. */
export class AnchorBuffer {
  readonly #dataCell: WritableSignal<readonly AnchorData[]>;
  readonly #coordinatesCell: WritableSignal<PackedArray>;

  readonly valuesCell: ComputedSignal<Float64Array>;
  readonly anchorsCell: ComputedSignal<readonly Anchor[]>;

  constructor(data: readonly AnchorData[], values: Float64Array) {
    if (values.length !== data.length * 2) {
      throw new RangeError("AnchorBuffer coordinate count must match its anchors");
    }

    this.#dataCell = signal(data, { name: "glyphLayer.anchors.data" });
    this.#coordinatesCell = signal(new PackedArray(2, values), {
      equals: () => false,
      name: "glyphLayer.anchors.coordinates",
    });
    this.valuesCell = computed(() => this.#coordinatesCell.value.view, {
      name: "glyphLayer.anchors.values",
    });
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

    const coordinates = this.#coordinatesCell.peek();
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
      const coordinates = this.#coordinatesCell.peek();
      coordinates.splice(
        coordinates.length,
        0,
        anchors.flatMap((anchor) => [anchor.x, anchor.y]),
      );
      this.#dataCell.set(data);
      this.#coordinatesCell.set(coordinates);
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
      const coordinates = this.#coordinatesCell.peek();
      for (let index = indexes.length - 1; index >= 0; index--) {
        coordinates.splice(indexes[index], 1);
      }
      this.#dataCell.set(data.filter((anchor) => !anchorIds.has(anchor.id)));
      this.#coordinatesCell.set(coordinates);
    });
  }

  patchPositions(updates: readonly GlyphPosition[]): void {
    const data = this.#dataCell.peek();
    const coordinates = this.#coordinatesCell.peek();
    let changed = false;
    for (const update of updates) {
      if (update.kind !== "anchor") continue;

      const index = data.findIndex((anchor) => anchor.id === update.id);
      if (index < 0) continue;
      changed = coordinates.setItem(index, [update.x, update.y]) || changed;
    }
    if (changed) this.#coordinatesCell.set(coordinates);
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== this.#dataCell.peek().length * 2) {
      throw new RangeError("AnchorBuffer replacement must match its anchors");
    }

    const coordinates = this.#coordinatesCell.peek();
    if (coordinates.replace(values)) this.#coordinatesCell.set(coordinates);
  }
}
