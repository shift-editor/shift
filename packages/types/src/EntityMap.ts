/** Thrown by {@link EntityMap.require} when a lookup must find its entity. */
export class EntityNotFoundError extends Error {
  /**
   * @param kind - What the map holds, such as `"glyph"` or `"window"`.
   * @param key - The key that was not found.
   */
  constructor(
    readonly kind: string,
    readonly key: unknown,
  ) {
    super(`${kind} ${String(key)} not found`);
    this.name = "EntityNotFoundError";
  }
}

/** Read access to an {@link EntityMap}, for indexes callers must not change. */
export interface ReadonlyEntityMap<K, V> extends Iterable<[K, V]> {
  readonly kind: string;
  readonly size: number;
  get(key: K): V | null;
  require(key: K): V;
  has(key: K): boolean;
  keys(): MapIterator<K>;
  values(): MapIterator<V>;
  entries(): MapIterator<[K, V]>;
  where(predicate: (value: V, key: K) => boolean): V[];
}

/**
 * An id-keyed collection with Shift's lookup conventions.
 *
 * @remarks
 * `get` returns `null` for a missing key, never `undefined`, so callers stop
 * converting with `?? null`; `require` throws a named {@link EntityNotFoundError}
 * when absence is a bug for that caller. Iteration follows insertion order.
 */
export class EntityMap<K, V> implements ReadonlyEntityMap<K, V> {
  readonly #entries: Map<K, V>;

  /**
   * @param kind - What the map holds, used in not-found errors.
   * @param entries - Initial entries, in insertion order.
   */
  constructor(
    readonly kind: string,
    entries: Iterable<readonly [K, V]> = [],
  ) {
    this.#entries = new Map(entries);
  }

  /** The number of entries. */
  get size(): number {
    return this.#entries.size;
  }

  /** Returns the entity for `key`, or `null` when there is none. */
  get(key: K): V | null {
    return this.#entries.get(key) ?? null;
  }

  /**
   * Returns the entity for `key`.
   *
   * @throws {EntityNotFoundError} when the map has no entity for `key`.
   */
  require(key: K): V {
    const value = this.#entries.get(key);
    if (value === undefined) throw new EntityNotFoundError(this.kind, key);
    return value;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  /** Adds or replaces the entity for `key`. */
  set(key: K, value: V): this {
    this.#entries.set(key, value);
    return this;
  }

  /** Removes the entity for `key`; returns whether there was one. */
  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  keys(): MapIterator<K> {
    return this.#entries.keys();
  }

  values(): MapIterator<V> {
    return this.#entries.values();
  }

  entries(): MapIterator<[K, V]> {
    return this.#entries.entries();
  }

  /** Returns the entities that satisfy `predicate`, in insertion order. */
  where(predicate: (value: V, key: K) => boolean): V[] {
    return this.#entries
      .entries()
      .filter(([key, value]) => predicate(value, key))
      .map(([, value]) => value)
      .toArray();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#entries.entries();
  }
}
