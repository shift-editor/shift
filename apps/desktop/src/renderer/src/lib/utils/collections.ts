import { mod } from "./utils";

/**
 * An indexed collection that wraps around at both ends, so advancing past
 * the last element returns to the first (and vice versa).
 *
 * Useful for cycling through tools, glyph lists, or any ordered set where
 * the user can step forward/backward indefinitely.
 *
 * Create via the static `CyclingCollection.create()` factory.
 */
export class CyclingCollection<T> {
  readonly #array: T[];
  #currentIndex: number = 0;

  private constructor(items: T[]) {
    this.#array = items;
  }

  /** Create a new cycling collection from the given items, starting at index 0. */
  static create<T>(items: T[]): CyclingCollection<T> {
    return new CyclingCollection(items);
  }

  /** Number of items in the collection. */
  get length(): number {
    return this.#array.length;
  }

  /** Readonly view of the underlying array. */
  get items(): readonly T[] {
    return this.#array;
  }

  /** Return the item at the current index. */
  current(): T {
    return this.#array[this.#currentIndex];
  }

  /** Jump to `index` (wraps around) and return the item there. */
  moveTo(index: number): T {
    this.#currentIndex = mod(index, this.length);
    return this.#array[this.#currentIndex];
  }

  /** Advance one step forward (wraps) and return the new current item. */
  next(): T {
    this.#currentIndex = mod(this.#currentIndex + 1, this.length);
    return this.#array[this.#currentIndex];
  }

  /** Step one position backward (wraps) and return the new current item. */
  prev(): T {
    this.#currentIndex = mod(this.#currentIndex - 1, this.length);
    return this.#array[this.#currentIndex];
  }

  /** Return the next item without moving the cursor. */
  peekNext(): T {
    return this.#array[mod(this.#currentIndex + 1, this.length)];
  }

  /** Return the previous item without moving the cursor. */
  peekPrev(): T {
    return this.#array[mod(this.#currentIndex - 1, this.length)];
  }

  /** Reset the cursor to index 0. */
  reset(): void {
    this.#currentIndex = 0;
  }

  /** Iterator support — allows `for...of` over the underlying items. */
  *[Symbol.iterator]() {
    yield* this.#array;
  }
}
