import { signal, type Signal, type WritableSignal } from "@/lib/signals";
import type { ShiftRecord } from "@/types";

export class ShiftStore<R extends ShiftRecord = ShiftRecord> {
  readonly #cell: WritableSignal<ReadonlyMap<R["id"], R>>;

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

  put(record: R): void {
    const current = this.#cell.peek();
    if (current.get(record.id) === record) return;

    const next = new Map(current);
    next.set(record.id, record);
    this.#cell.set(next);
  }

  get(id: R["id"]): R | null {
    return this.#cell.peek().get(id) ?? null;
  }

  delete(id: R["id"]): void {
    const current = this.#cell.peek();
    if (!current.has(id)) return;

    const next = new Map(current);
    next.delete(id);
    this.#cell.set(next);
  }

  clear(): void {
    if (this.#cell.peek().size === 0) return;

    this.#cell.set(new Map());
  }
}
