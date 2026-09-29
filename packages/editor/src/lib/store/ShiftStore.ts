import { batch, signal, type Signal, type WritableSignal } from "../signals/index";
import type { ShiftRecord } from "../../types/records";
import type { StoreChange } from "../../types/store";

export class ShiftStore<R extends ShiftRecord = ShiftRecord> {
  readonly #cell: WritableSignal<ReadonlyMap<R["id"], R>>;
  // non-reactive: subscriber registry; listeners are invoked imperatively, never read in computeds
  readonly #changeListeners = new Set<(change: StoreChange<R>) => void>();

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
    for (const listener of this.#changeListeners) listener(change);
  }
}
