import { signal, track, type WritableSignal } from "../signals/index";
import type { ShiftRecord } from "../../types/records";
import type { StoreChange, StoreIndexSource } from "../../types/store";

/**
 * A reactive reverse lookup over one record type: records filed under the keys they declare.
 *
 * @remarks
 * Created by {@link ShiftStore.index}. The index applies each store change to
 * the keys that change touched rather than rebuilding, and readers subscribe
 * per key: a reader of one key reruns only when the records under that key
 * change. Records under a key keep the order they were first filed in.
 */
export class StoreIndex<K, V extends ShiftRecord> {
  readonly #accepts: (record: ShiftRecord) => record is V;
  readonly #keys: (record: V) => Iterable<K>;
  // non-reactive: backing table updated from store changes; readers only see the per-key #cells
  readonly #byKey = new Map<K, Map<V["id"], V>>();
  readonly #cells = new Map<K, WritableSignal<readonly V[]>>();
  readonly #unsubscribe: () => void;

  constructor(
    source: StoreIndexSource,
    accepts: (record: ShiftRecord) => record is V,
    keys: (record: V) => Iterable<K>,
  ) {
    this.#accepts = accepts;
    this.#keys = keys;
    for (const record of source.records()) {
      if (!accepts(record)) continue;
      for (const key of keys(record)) this.#file(key, record);
    }
    this.#unsubscribe = source.onChange((change) => this.#apply(change));
  }

  /**
   * Returns the records filed under `key`.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns when a record is
   * filed under or removed from `key`, or a record under it is replaced.
   */
  get(key: K): readonly V[] {
    const cell = this.#cell(key);
    track(cell);
    return cell.peek();
  }

  /** Stops following the store. Readers keep the last records they saw. */
  dispose(): void {
    this.#unsubscribe();
  }

  #apply(change: StoreChange<ShiftRecord>): void {
    const before = change.before && this.#accepts(change.before) ? change.before : null;
    const after = change.after && this.#accepts(change.after) ? change.after : null;
    if (!before && !after) return;

    const oldKeys = new Set(before ? this.#keys(before) : []);
    const newKeys = new Set(after ? this.#keys(after) : []);
    for (const key of oldKeys) {
      if (!newKeys.has(key)) this.#unfile(key, change.id);
    }
    if (after) {
      for (const key of newKeys) this.#file(key, after);
    }

    for (const key of new Set([...oldKeys, ...newKeys])) {
      this.#cells.get(key)?.set(this.#snapshot(key));
    }
  }

  #file(key: K, record: V): void {
    let records = this.#byKey.get(key);
    if (!records) {
      records = new Map();
      this.#byKey.set(key, records);
    }
    records.set(record.id, record);
  }

  #unfile(key: K, id: V["id"]): void {
    const records = this.#byKey.get(key);
    if (!records) return;

    records.delete(id);
    if (records.size === 0) this.#byKey.delete(key);
  }

  #cell(key: K): WritableSignal<readonly V[]> {
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = signal(this.#snapshot(key), { name: "editor.store.index" });
      this.#cells.set(key, cell);
    }
    return cell;
  }

  #snapshot(key: K): readonly V[] {
    return [...(this.#byKey.get(key)?.values() ?? [])];
  }
}
