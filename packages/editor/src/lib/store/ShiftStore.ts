import { batch, signal, track, type Signal, type WritableSignal } from "../signals/index";
import type { ShiftRecord } from "../../types/records";
import type { StoreChange } from "../../types/store";
import { StoreIndex } from "./StoreIndex";

export class ShiftStore<R extends ShiftRecord = ShiftRecord> {
  readonly #cell: WritableSignal<ReadonlyMap<R["id"], R>>;
  // non-reactive: subscriber registry; listeners are invoked imperatively, never read in computeds
  readonly #changeListeners = new Set<(change: StoreChange<R>) => void>();
  readonly #recordCells = new Map<R["id"], WritableSignal<R | null>>();
  // non-reactive: one lazily created index per record type; each index holds its own signals
  readonly #typeIndexes = new Map<R["type"], StoreIndex<R["type"], R>>();

  constructor(records: readonly R[] = []) {
    this.#cell = signal<ReadonlyMap<R["id"], R>>(
      new Map(records.map((record) => [record.id, record])),
      {
        name: "editor.store",
      },
    );
  }

  get cell(): Signal<ReadonlyMap<R["id"], R>> {
    return this.#cell;
  }

  records(): readonly R[] {
    return [...this.#cell.peek().values()];
  }

  /**
   * Returns one record, subscribing only to that record.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns when this record
   * is put or deleted, and not when any other record changes. Returns null for
   * a missing record and keeps the subscription, so a later put reaches the reader.
   */
  record(id: R["id"]): R | null {
    let cell = this.#recordCells.get(id);
    if (!cell) {
      cell = signal(this.get(id), { name: "editor.store.record" });
      this.#recordCells.set(id, cell);
    }
    track(cell);
    return cell.peek();
  }

  /**
   * Returns every record of one type.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when a
   * record of `type` is put or deleted, not when records of other types
   * change. Records keep the order they were first put in.
   */
  recordsOfType<T extends R["type"]>(type: T): readonly Extract<R, { type: T }>[] {
    let index = this.#typeIndexes.get(type);
    if (!index) {
      index = new StoreIndex<R["type"], R>(
        this,
        (record): record is R => record.type === type,
        () => [type],
      );
      this.#typeIndexes.set(type, index);
    }
    // The index for `type` only ever files records whose type is `type`.
    return index.get(type) as readonly Extract<R, { type: T }>[];
  }

  /**
   * Creates a reactive reverse lookup over one record type.
   *
   * @remarks
   * Each record of `type` is filed under every key `keys` returns for it. The
   * index applies each change incrementally and readers subscribe per key; see
   * {@link StoreIndex}. Create an index once, in the module that owns the
   * concept, expose it through named methods, and dispose it with that module.
   *
   * @param type - record type to index.
   * @param keys - keys a record is found under; may be empty.
   */
  index<T extends R["type"], K>(
    type: T,
    keys: (record: Extract<R, { type: T }>) => Iterable<K>,
  ): StoreIndex<K, Extract<R, { type: T }>> {
    return new StoreIndex<K, Extract<R, { type: T }>>(
      this,
      (record): record is Extract<R, { type: T }> => record.type === type,
      keys,
    );
  }

  /**
   * Subscribes to completed whole-record replacements.
   *
   * @param listener - Observer called synchronously after each store mutation.
   * @returns an idempotent function that removes the observer.
   */
  onChange(listener: (change: StoreChange<R>) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  put(record: R): void {
    const current = this.#cell.peek();
    const before = current.get(record.id) ?? null;
    if (before === record) return;

    const next = new Map(current);
    next.set(record.id, record);
    batch(() => {
      this.#cell.set(next);
      this.#emitChange({ id: record.id, before, after: record });
    });
  }

  get(id: R["id"]): R | null {
    return this.#cell.peek().get(id) ?? null;
  }

  delete(id: R["id"]): void {
    const current = this.#cell.peek();
    const before = current.get(id);
    if (!before) return;

    const next = new Map(current);
    next.delete(id);
    batch(() => {
      this.#cell.set(next);
      this.#emitChange({ id, before, after: null });
    });
  }

  clear(): void {
    const current = this.#cell.peek();
    if (current.size === 0) return;

    batch(() => {
      this.#cell.set(new Map());
      for (const [id, before] of current) this.#emitChange({ id, before, after: null });
    });
  }

  #emitChange(change: StoreChange<R>): void {
    this.#recordCells.get(change.id)?.set(change.after);
    for (const listener of this.#changeListeners) listener(change);
  }
}
