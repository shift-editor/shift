import type { DecomposedTransform } from "@shift/geo";
import type { ComponentData } from "@shift/types";
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
    if (values.length !== 9) {
      throw new RangeError("ComponentBuffer requires one nine-value transform");
    }

    this.data = data;
    this.#transform = new PackedArray(9, values);
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
    const values = this.#transform.view;
    return {
      translateX: values[0],
      translateY: values[1],
      rotation: values[2],
      scaleX: values[3],
      scaleY: values[4],
      skewX: values[5],
      skewY: values[6],
      tCenterX: values[7],
      tCenterY: values[8],
    };
  }

  setTransform(transform: DecomposedTransform): void {
    this.replaceValues(
      Float64Array.of(
        transform.translateX,
        transform.translateY,
        transform.rotation,
        transform.scaleX,
        transform.scaleY,
        transform.skewX,
        transform.skewY,
        transform.tCenterX,
        transform.tCenterY,
      ),
    );
  }

  replaceValues(values: Float64Array): void {
    if (values.length !== 9) {
      throw new RangeError("ComponentBuffer replacement requires nine values");
    }

    const transform = this.#transform;
    if (transform.replace(values)) this.#markChanged();
  }

  /** Publishes an in-place change to the packed values. */
  #markChanged(): void {
    this.#revision.update((revision) => revision + 1);
  }
}
