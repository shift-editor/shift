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
   * Creates a new CyclingCollection, returns null for empty arrays
   */
  static create<T>(items: T[]): CyclingCollection<T> {
    return new CyclingCollection(items);
  }

  /** Array-like methods */
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
    this.#currentIndex = index % this.length;
    return this.#array[this.#currentIndex];
  }

  next(): T {
    this.#currentIndex = (this.#currentIndex + 1) % this.length;
    return this.#array[this.#currentIndex];
  }

  prev(): T {
    this.#currentIndex = (this.#currentIndex - 1 + this.length) % this.length;
    return this.#array[this.#currentIndex];
  }

  peekNext(): T {
    return this.#array[(this.#currentIndex + 1) % this.length];
  }

  peekPrev(): T {
    return this.#array[(this.#currentIndex - 1 + this.length) % this.length];
  }

  reset(): void {
    this.#currentIndex = 0;
  }

  /** Iterator support */
  *[Symbol.iterator]() {
    yield* this.#array;
  }
}
