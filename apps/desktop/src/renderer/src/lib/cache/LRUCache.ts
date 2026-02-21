export class LRUCache<K, V> {
  #capacity: number;
  #cache: Map<K, V>;
  #onEvict: ((key: K, value: V) => void) | undefined;

  constructor(options: { max: number; onEvict?: (key: K, value: V) => void }) {
    this.#capacity = options.max;
    this.#cache = new Map();
    this.#onEvict = options.onEvict;
  }

  get(key: K): V | undefined {
    const value = this.#cache.get(key);
    if (value !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    }
    if (this.#cache.size >= this.#capacity) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) {
        const oldestValue = this.#cache.get(oldest)!;
        this.#cache.delete(oldest);
        this.#onEvict?.(oldest, oldestValue);
      }
    }
    this.#cache.set(key, value);
  }

  has(key: K): boolean {
    return this.#cache.has(key);
  }

  delete(key: K): boolean {
    return this.#cache.delete(key);
  }

  clear(): void {
    this.#cache.clear();
  }

  get size(): number {
    return this.#cache.size;
  }
}
