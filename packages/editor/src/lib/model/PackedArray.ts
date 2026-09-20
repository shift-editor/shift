/**
 * A dynamically-sized array of fixed-width numeric records.
 *
 * Packed layout arithmetic belongs here. Callers address logical records and
 * components; they never multiply record indices by a stride or move scalar
 * ranges themselves. Capacity may grow, but `itemSize` never changes.
 */
export class PackedArray {
  readonly itemSize: number;

  #buffer: Float64Array;
  #length: number;

  constructor(itemSize: number, values: Float64Array = new Float64Array()) {
    if (!Number.isInteger(itemSize) || itemSize <= 0) {
      throw new RangeError("PackedArray itemSize must be a positive integer");
    }
    if (values.length % itemSize !== 0) {
      throw new RangeError("PackedArray values must contain complete records");
    }

    this.itemSize = itemSize;
    this.#buffer = new Float64Array(values);
    this.#length = values.length / itemSize;
  }

  /** Number of logical records, not scalar values. */
  get length(): number {
    return this.#length;
  }

  /** Live view containing only logical records. Do not retain it across structural edits. */
  get view(): Float64Array {
    return this.#buffer.subarray(0, this.#length * this.itemSize);
  }

  getComponent(index: number, component: number): number {
    this.#assertItemIndex(index);
    if (!Number.isInteger(component) || component < 0 || component >= this.itemSize) {
      throw new RangeError(`PackedArray component ${component} is out of range`);
    }

    return this.#buffer[index * this.itemSize + component] ?? 0;
  }

  setItem(index: number, values: readonly number[] | Float64Array): boolean {
    this.#assertItemIndex(index);
    if (values.length !== this.itemSize) {
      throw new RangeError(`PackedArray item must contain ${this.itemSize} values`);
    }

    const offset = index * this.itemSize;
    let changed = false;
    for (let component = 0; component < this.itemSize; component++) {
      const value = values[component] ?? 0;
      if (this.#buffer[offset + component] !== value) changed = true;
      this.#buffer[offset + component] = value;
    }
    return changed;
  }

  splice(
    index: number,
    deleteCount: number,
    values: readonly number[] | Float64Array = [],
  ): boolean {
    if (!Number.isInteger(index) || index < 0 || index > this.#length) {
      throw new RangeError(`PackedArray index ${index} is out of range`);
    }
    if (!Number.isInteger(deleteCount) || deleteCount < 0 || index + deleteCount > this.#length) {
      throw new RangeError(`PackedArray deleteCount ${deleteCount} is out of range`);
    }
    if (values.length % this.itemSize !== 0) {
      throw new RangeError("PackedArray splice values must contain complete records");
    }

    const insertCount = values.length / this.itemSize;
    if (deleteCount === 0 && insertCount === 0) return false;

    const nextLength = this.#length - deleteCount + insertCount;
    this.#ensureCapacity(nextLength);

    const start = index * this.itemSize;
    const tailStart = (index + deleteCount) * this.itemSize;
    const nextTailStart = (index + insertCount) * this.itemSize;
    const scalarLength = this.#length * this.itemSize;
    if (tailStart !== nextTailStart) {
      this.#buffer.copyWithin(nextTailStart, tailStart, scalarLength);
    }
    this.#buffer.set(values, start);
    this.#length = nextLength;
    return true;
  }

  reverse(): boolean {
    if (this.#length < 2) return false;

    for (let left = 0, right = this.#length - 1; left < right; left++, right--) {
      for (let component = 0; component < this.itemSize; component++) {
        const leftIndex = left * this.itemSize + component;
        const rightIndex = right * this.itemSize + component;
        const value = this.#buffer[leftIndex] ?? 0;
        this.#buffer[leftIndex] = this.#buffer[rightIndex] ?? 0;
        this.#buffer[rightIndex] = value;
      }
    }
    return true;
  }

  replace(values: Float64Array): boolean {
    if (values.length % this.itemSize !== 0) {
      throw new RangeError("PackedArray replacement must contain complete records");
    }
    if (this.#sameValues(values)) return false;

    const length = values.length / this.itemSize;
    this.#ensureCapacity(length);
    this.#buffer.set(values);
    this.#length = length;
    return true;
  }

  #sameValues(values: Float64Array): boolean {
    const current = this.view;
    if (current.length !== values.length) return false;
    for (let index = 0; index < current.length; index++) {
      if (current[index] !== values[index]) return false;
    }
    return true;
  }

  #ensureCapacity(length: number): void {
    const scalarLength = length * this.itemSize;
    if (scalarLength <= this.#buffer.length) return;

    const currentCapacity = this.#buffer.length / this.itemSize;
    const capacity = Math.max(length, Math.max(4, currentCapacity * 2));
    const buffer = new Float64Array(capacity * this.itemSize);
    buffer.set(this.view);
    this.#buffer = buffer;
  }

  #assertItemIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.#length) {
      throw new RangeError(`PackedArray index ${index} is out of range`);
    }
  }
}
