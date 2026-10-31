import type { DecomposedTransform } from "@shift/geo";
import { readDecomposedTransform } from "@shift/glyph-state";
import { DECOMPOSED_COMPONENT_VALUE_COUNT, type ComponentData } from "@shift/types";
import {
  computed,
  signal,
  type ComputedSignal,
  type WritableSignal,
  track,
} from "../signals/signal";
import { PackedArray } from "./PackedArray";

/** Component metadata and its fixed-width decomposed transform record. */
export class ComponentBuffer {
  readonly data: ComponentData;

  readonly #transform: PackedArray;
  /** Bumped after each in-place change to `#transform`; readers track this, not the array. */
  readonly #revision: WritableSignal<number>;
  readonly valuesCell: ComputedSignal<Float64Array>;

  constructor(data: ComponentData, values: Float64Array, componentIndex: number) {
    if (values.length !== DECOMPOSED_COMPONENT_VALUE_COUNT) {
      throw new RangeError("ComponentBuffer requires one decomposed transform");
    }

    this.data = data;
    this.#transform = new PackedArray(DECOMPOSED_COMPONENT_VALUE_COUNT, values);
    this.#revision = signal(0, { name: `glyphLayer.component[${componentIndex}].transform` });
    this.valuesCell = computed(
      () => {
        track(this.#revision);
        // A fresh view over the same memory, so readers see a new value per revision.
        return this.#transform.view;
      },
      {
        name: `glyphLayer.component[${componentIndex}].values`,
      },
    );
  }

  get transform(): DecomposedTransform {
    return readDecomposedTransform(this.#transform.view, 0);
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== DECOMPOSED_COMPONENT_VALUE_COUNT) {
      throw new RangeError("ComponentBuffer replacement requires one decomposed transform");
    }

    const transform = this.#transform;
    if (transform.replace(values)) this.#markChanged();
  }

  /** Publishes an in-place change to the packed values. */
  #markChanged(): void {
    this.#revision.update((revision) => revision + 1);
  }
}
