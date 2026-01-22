import { mod } from "./utils";

/**
 * A cycling collection that wraps an array
 */
export class CyclingCollection<T> {
  readonly #array: T[];
  #currentIndex: number = 0;

  private constructor(items: T[]) {
    this.#array = items;
  }

  /**
   * Creates a new CyclingCollection
   */
  static create<T>(items: T[]): CyclingCollection<T> {
    return new CyclingCollection(items);
  }

  get length(): number {
    return this.#array.length;
  }

  get items(): readonly T[] {
    return this.#array;
  }

  current(): T {
    return this.#array[this.#currentIndex];
  }

  moveTo(index: number): T {
    this.#currentIndex = mod(index, this.length);
    return this.#array[this.#currentIndex];
  }

  next(): T {
    this.#currentIndex = mod(this.#currentIndex + 1, this.length);
    return this.#array[this.#currentIndex];
  }

  prev(): T {
    this.#currentIndex = mod(this.#currentIndex - 1, this.length);
    return this.#array[this.#currentIndex];
  }

  peekNext(): T {
    return this.#array[mod(this.#currentIndex + 1, this.length)];
  }

  peekPrev(): T {
    return this.#array[mod(this.#currentIndex - 1, this.length)];
  }

  reset(): void {
    this.#currentIndex = 0;
  }

  /** Iterator support */
  *[Symbol.iterator]() {
    yield* this.#array;
  }
}
