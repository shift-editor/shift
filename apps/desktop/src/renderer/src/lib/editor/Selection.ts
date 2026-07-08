import { computed, type Signal } from "@/lib/signals/signal";
import type { ShiftStore } from "@/lib/store/ShiftStore";
import { uniqueInOrder } from "@/lib/utils/utils";
import { currentSelectionId, type SelectableId, type ShiftEditorRecord } from "@/types";

export interface SelectionState {
  readonly ids: readonly SelectableId[];
}

function emptySelectionState(): SelectionState {
  return { ids: [] };
}

/**
 * Stores selected editor object identities.
 *
 * @remarks
 * Selection is intentionally a dumb ordered set. It does not know whether an id
 * is a scene node, point, anchor, contour, or segment.
 * Callers that need behavior must resolve ids through the editor/object layer.
 */
export class Selection {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #ids: Signal<ReadonlySet<SelectableId>>;
  readonly stateCell: Signal<SelectionState>;

  constructor(store: ShiftStore<ShiftEditorRecord>) {
    this.#store = store;
    this.stateCell = computed(
      () => {
        const record = this.#store.cell.value.get(currentSelectionId);
        if (record?.type !== "selection") return emptySelectionState();

        return { ids: record.ids };
      },
      { name: "editor.selection.state" },
    );
    this.#ids = computed(() => new Set(this.stateCell.value.ids), {
      name: "editor.selection.ids",
    });
  }

  get snapshot(): SelectionState {
    return this.stateCell.peek();
  }

  /**
   * Returns selected ids in selection order.
   *
   * @returns a fresh snapshot array; mutating it does not change selection.
   */
  get ids(): readonly SelectableId[] {
    return [...this.stateCell.peek().ids];
  }

  has(id: SelectableId): boolean {
    return this.#ids.peek().has(id);
  }

  isSelected(id: SelectableId): boolean {
    return this.has(id);
  }

  hasSelection(): boolean {
    return this.stateCell.peek().ids.length > 0;
  }

  select(ids: readonly SelectableId[]): void {
    this.#write(uniqueInOrder(ids));
  }

  add(id: SelectableId): void {
    if (this.has(id)) return;

    this.#write([...this.stateCell.peek().ids, id]);
  }

  remove(id: SelectableId): void {
    if (!this.has(id)) return;

    const ids = this.stateCell.peek().ids.filter((selectedId) => selectedId !== id);
    if (ids.length === 0) {
      this.clear();
      return;
    }

    this.#write(ids);
  }

  toggle(id: SelectableId): void {
    if (this.has(id)) {
      this.remove(id);
      return;
    }

    this.add(id);
  }

  clear(): void {
    if (!this.hasSelection()) return;

    this.#store.delete(currentSelectionId);
  }

  #write(ids: readonly SelectableId[]): void {
    if (ids.length === 0) {
      this.clear();
      return;
    }

    this.#store.put({
      id: currentSelectionId,
      type: "selection",
      scope: "session",
      ids,
    });
  }
}
