import { computed, type Signal } from "../signals/signal";
import type { ShiftStore } from "../store/ShiftStore";
import { uniqueInOrder } from "../utils/utils";
import { currentEditingId } from "../../types/editing";
import type { ShiftEditorRecord } from "../../types/records";
import type { ShiftNode } from "../../types/node";
import type { Scene } from "./Scene";
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
  readonly #scene: Scene;
  readonly #nodeIds: Signal<ReadonlySet<NodeId>>;
  readonly stateCell: Signal<EditingState>;

  constructor(store: ShiftStore<ShiftEditorRecord>, scene: Scene) {
    this.#store = store;
    this.#scene = scene;
    this.stateCell = computed(
      () => {
        const record = this.#store.record(currentEditingId);
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

  /**
   * Returns the entered node of one kind.
   *
   * @returns null when no node of `kind` is entered, or more than one is.
   */
  node<K extends ShiftNode["kind"]>(kind: K): Extract<ShiftNode, { kind: K }> | null {
    const entered = this.nodeIds.flatMap((id) => this.#scene.nodeOfKind(id, kind) ?? []);
    return entered.length === 1 ? (entered[0] ?? null) : null;
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

  /**
   * Clears editing scope until the returned function restores it.
   *
   * @remarks
   * For modes that show glyphs as plain content (Hand, Text). The restore
   * skips nodes deleted in the meantime.
   *
   * @returns a function that re-enters the suspended nodes.
   */
  suspend(): () => void {
    const nodeIds = this.nodeIds;
    this.clear();
    return () => this.set(nodeIds.filter((id) => this.#store.get(id)?.type === "node"));
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
