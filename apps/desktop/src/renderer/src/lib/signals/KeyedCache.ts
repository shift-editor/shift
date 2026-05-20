import { signal, type Signal, type WritableSignal } from "./signal";

export interface KeyedCacheOptions<Input, Key, Value> {
  readonly name?: string;
  readonly key: (input: Input) => Key;
  readonly create: (input: Signal<Input>) => Value;
  readonly dispose?: (value: Value) => void;
  readonly equals?: (previous: Input, next: Input) => boolean;
}

interface KeyedCacheEntry<Input, Value> {
  readonly input: WritableSignal<Input>;
  readonly value: Value;
}

/**
 * Reuses keyed objects while updating their constructor-like input reactively.
 *
 * @remarks
 * Use this inside computed derivations that produce objects with semantic
 * identity, such as contour, anchor, or render-item wrappers. The cached object
 * receives a signal containing its latest input; when the same key appears
 * again, the object is reused and only that input signal is updated.
 */
export class KeyedCache<Input, Key, Value> {
  readonly #options: KeyedCacheOptions<Input, Key, Value>;
  readonly #entries = new Map<Key, KeyedCacheEntry<Input, Value>>();

  /**
   * Creates a keyed object cache.
   *
   * @param options - Key, creation, equality, and disposal behavior for cached entries.
   */
  constructor(options: KeyedCacheOptions<Input, Key, Value>) {
    this.#options = options;
  }

  /**
   * Returns the cached value for one input, creating it when needed.
   *
   * @param input - Current input for the keyed value.
   * @returns The stable cached value associated with `options.key(input)`.
   */
  get(input: Input): Value {
    const key = this.#options.key(input);
    const existing = this.#entries.get(key);
    if (existing) {
      existing.input.set(input);
      return existing.value;
    }

    const inputCell = signal(input, {
      equals: this.#options.equals,
      name: this.#inputName(key),
    });
    const value = this.#options.create(inputCell);
    this.#entries.set(key, { input: inputCell, value });
    return value;
  }

  /**
   * Maps an ordered input list to stable cached values and removes missing keys.
   *
   * @param inputs - Current ordered inputs for the derived object list.
   * @returns Cached values in the same order as `inputs`.
   */
  map(inputs: readonly Input[]): readonly Value[] {
    const seen = new Set<Key>();
    const values: Value[] = [];

    for (const input of inputs) {
      const key = this.#options.key(input);
      seen.add(key);
      values.push(this.get(input));
    }

    for (const [key, entry] of this.#entries) {
      if (seen.has(key)) continue;
      const dispose = this.#options.dispose;
      if (dispose) dispose(entry.value);
      this.#entries.delete(key);
    }

    return values;
  }

  /**
   * Removes every cached value.
   */
  clear(): void {
    const dispose = this.#options.dispose;
    for (const entry of this.#entries.values()) {
      if (dispose) dispose(entry.value);
    }
    this.#entries.clear();
  }

  #inputName(key: Key): string | undefined {
    const name = this.#options.name;
    if (!name) return undefined;
    return `${name}.${String(key)}`;
  }
}

/**
 * Creates a keyed cache with generic inference from the options object.
 *
 * @param options - Key, creation, equality, and disposal behavior for cached entries.
 * @returns A cache that reuses values by `options.key(input)`.
 */
export function keyedCache<Input, Key, Value>(
  options: KeyedCacheOptions<Input, Key, Value>,
): KeyedCache<Input, Key, Value> {
  return new KeyedCache(options);
}
