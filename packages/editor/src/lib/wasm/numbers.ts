import { nameFor, nameId } from "./names";

/**
 * Writes a hot call's input as numbers, in the layout Rust declares.
 *
 * @remarks
 * Used only by the generated `generated/layouts.ts`. Calls share one growing
 * buffer: {@link NumberWriter.finish} returns a view of it that stays valid
 * until the next call starts writing, which is enough because the module
 * copies its input when called.
 */
export class NumberWriter {
  static #shared: NumberWriter | null = null;

  #values = new Float64Array(256);
  #length = 0;

  /** Returns the shared writer, emptied. */
  static shared(): NumberWriter {
    NumberWriter.#shared ??= new NumberWriter();
    NumberWriter.#shared.#length = 0;
    return NumberWriter.#shared;
  }

  number(value: number): void {
    if (this.#length === this.#values.length) {
      const grown = new Float64Array(this.#values.length * 2);
      grown.set(this.#values);
      this.#values = grown;
    }
    this.#values[this.#length++] = value;
  }

  count(value: number): void {
    this.number(value);
  }

  flag(value: boolean): void {
    this.number(value ? 1 : 0);
  }

  /** Writes a name as its interned id. */
  name(value: string): void {
    this.number(nameId(value));
  }

  /** Returns the numbers written, as a view valid until the next call. */
  finish(): Float64Array {
    return this.#values.subarray(0, this.#length);
  }
}

/**
 * Reads a hot call's output in the layout Rust declares.
 *
 * @remarks
 * Used only by the generated `generated/layouts.ts`. Reading past the end
 * yields zeros, as Rust's reader does.
 */
export class NumberReader {
  readonly #values: Float64Array;
  #at = 0;

  constructor(values: Float64Array) {
    this.#values = values;
  }

  number(): number {
    return this.#values[this.#at++] ?? 0;
  }

  count(): number {
    return Math.max(0, this.number());
  }

  flag(): boolean {
    return this.number() !== 0;
  }

  /** Reads an interned id as its name. */
  name(): string {
    return nameFor(this.count());
  }

  /** Reads a count, then that many items. */
  list<T>(item: () => T): T[] {
    const count = this.count();
    const items: T[] = [];
    for (let index = 0; index < count; index++) items.push(item());
    return items;
  }
}
