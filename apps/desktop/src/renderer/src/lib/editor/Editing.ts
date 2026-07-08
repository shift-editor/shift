import { computed, type Signal } from "@/lib/signals/signal";
import type { ShiftStore } from "@/lib/store/ShiftStore";
import { uniqueInOrder } from "@/lib/utils/utils";
import { currentEditingId, type ShiftEditorRecord } from "@/types";
import type { NodeId } from "@shift/types";

export interface EditingState {
  readonly nodeIds: readonly NodeId[];
}

function emptyEditingState(): EditingState {
  return { nodeIds: [] };
}

/**
 * Stores which scene nodes expose editable internals in this editor session.
 *
 * @remarks
 * Editing scope is session state, not document state. It is intentionally
 * plural even though the first UI flow enters one node at a time.
 */
export class Editing {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #nodeIds: Signal<ReadonlySet<NodeId>>;
  readonly stateCell: Signal<EditingState>;

  constructor(store: ShiftStore<ShiftEditorRecord>) {
    this.#store = store;
    this.stateCell = computed(
      () => {
        const record = this.#store.cell.value.get(currentEditingId);
        if (record?.type !== "editing") return emptyEditingState();

        return { nodeIds: record.nodeIds };
      },
      { name: "editor.editing.state" },
    );
    this.#nodeIds = computed(() => new Set(this.stateCell.value.nodeIds), {
      name: "editor.editing.nodeIds",
    });
  }

  get snapshot(): EditingState {
    return this.stateCell.peek();
  }

  /**
   * Returns node ids currently exposing editable internals.
   *
   * @returns a fresh snapshot array; mutating it does not change editing scope.
   */
  get nodeIds(): readonly NodeId[] {
    return [...this.stateCell.peek().nodeIds];
  }

  has(nodeId: NodeId): boolean {
    return this.#nodeIds.peek().has(nodeId);
  }

  isEditing(nodeId: NodeId): boolean {
    return this.has(nodeId);
  }

  hasScope(): boolean {
    return this.stateCell.peek().nodeIds.length > 0;
  }

  enter(nodeId: NodeId): void {
    this.set([nodeId]);
  }

  set(nodeIds: readonly NodeId[]): void {
    this.#write(uniqueInOrder(nodeIds));
  }

  clear(): void {
    if (!this.hasScope()) return;

    this.#store.delete(currentEditingId);
  }

  #write(nodeIds: readonly NodeId[]): void {
    if (nodeIds.length === 0) {
      this.clear();
      return;
    }

    this.#store.put({
      id: currentEditingId,
      type: "editing",
      scope: "session",
      nodeIds,
    });
  }
}
