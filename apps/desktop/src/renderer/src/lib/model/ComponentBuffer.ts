import type { ComponentData } from "@shift/types";
import { computed, signal, type ComputedSignal, type WritableSignal } from "@/lib/signals/signal";
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

  replaceValues(values: Float64Array): void {
    if (values.length !== 9) {
      throw new RangeError("ComponentBuffer replacement requires nine values");
    }

    const transform = this.#transformCell.peek();
    if (transform.replace(values)) this.#transformCell.set(transform);
  }
}
