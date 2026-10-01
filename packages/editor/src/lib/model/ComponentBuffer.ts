import type { DecomposedTransform } from "@shift/geo";
import type { ComponentData } from "@shift/types";
import { computed, signal, type ComputedSignal, type WritableSignal } from "../signals/signal";
import { PackedArray } from "./PackedArray";

/** Component metadata and its fixed-width decomposed transform record. */
export class ComponentBuffer {
  readonly data: ComponentData;

  readonly #transformCell: WritableSignal<PackedArray>;
  readonly valuesCell: ComputedSignal<Float64Array>;

  constructor(data: ComponentData, values: Float64Array, componentIndex: number) {
    if (values.length !== 9) {
      throw new RangeError("ComponentBuffer requires one nine-value transform");
    }

    this.data = data;
    this.#transformCell = signal(new PackedArray(9, values), {
      equals: () => false,
      name: `glyphLayer.component[${componentIndex}].transform`,
    });
    this.valuesCell = computed(() => this.#transformCell.value.view, {
      name: `glyphLayer.component[${componentIndex}].values`,
    });
  }

  get transform(): DecomposedTransform {
    const values = this.#transformCell.peek().view;
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

    const transform = this.#transformCell.peek();
    if (transform.replace(values)) this.#transformCell.set(transform);
  }
}
