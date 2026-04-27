/**
 * Bounded least-recently-used cache backed by a Map.
 *
 * Map preserves insertion order; we delete-and-reinsert on every `get` and
 * `set` of an existing key to push it to the most-recent end. The next
 * eviction takes the first key returned by the iterator, which is the LRU
 * entry.
 *
 * `onEvict` runs when an entry is dropped (capacity overflow or `clear`),
 * giving the owner a hook to release resources tied to the value.
 */
export class LruCache<K, V> {
  readonly #capacity: number;
  readonly #entries = new Map<K, V>();
  readonly #onEvict?: (value: V, key: K) => void;

  constructor(capacity: number, onEvict?: (value: V, key: K) => void) {
    if (capacity < 1) throw new Error("LruCache capacity must be >= 1");
    this.#capacity = capacity;
    this.#onEvict = onEvict;
  }

  get(key: K): V | undefined {
    const v = this.#entries.get(key);
    if (v === undefined) return undefined;

    this.#entries.delete(key);
    this.#entries.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.#entries.has(key)) this.#entries.delete(key);
    this.#entries.set(key, value);

    if (this.#entries.size > this.#capacity) {
      const oldestKey = this.#entries.keys().next().value as K;
      const evicted = this.#entries.get(oldestKey)!;
      this.#entries.delete(oldestKey);
      if (this.#onEvict) this.#onEvict(evicted, oldestKey);
    }
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    if (this.#onEvict) {
      for (const [k, v] of this.#entries) this.#onEvict(v, k);
    }
    this.#entries.clear();
  }
}
