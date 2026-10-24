import { computed, track, type Signal } from "../signals/signal";
import type { ShiftStore } from "../store/ShiftStore";
import { uniqueInOrder } from "../utils/utils";
import type { Scene } from "./Scene";
import {
  currentEditingId,
  type EditContextOfKind,
  type EditContextResolver,
  type EditingState,
  type NodeEditContext,
} from "../../types/editing";
import type { NodeKind, ShiftNode } from "../../types/node";
import type { ShiftEditorRecord } from "../../types/records";
import type { NodeId } from "@shift/types";

const NO_NODE_IDS: readonly NodeId[] = [];
const EMPTY_EDITING_STATE: EditingState = { nodeIds: NO_NODE_IDS, suspendedNodeIds: NO_NODE_IDS };

/**
 * Stores which scene nodes expose editable internals in this editor session.
 *
 * @remarks
 * Editing scope is session state, not document state. It is intentionally
 * plural even though the first UI flow enters one node at a time.
 *
 * Readers come in two kinds. {@link only}, {@link onlyCell} and {@link of}
 * answer "what am I editing" and are empty while editing is suspended, so
 * tools act on nothing in Hand and Text modes. {@link subject} and
 * {@link subjectCell} answer "what is this session about" and keep answering
 * while suspended, for displays such as the glyph sidebar.
 */
export class Editing {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #scene: Scene;
  readonly #editContext: EditContextResolver;
  readonly #nodeIds: Signal<ReadonlySet<NodeId>>;
  readonly #onlyCellsByKind = new Map<NodeKind, Signal<NodeEditContext | null>>();
  readonly #subjectCellsByKind = new Map<NodeKind, Signal<NodeEditContext | null>>();
  readonly stateCell: Signal<EditingState>;

  /**
   * @param store - editor store holding the editing record.
   * @param scene - scene the edited node ids resolve in.
   * @param editContext - what editing a node exposes; usually its definition's `editContext`.
   */
  constructor(
    store: ShiftStore<ShiftEditorRecord>,
    scene: Scene,
    editContext: EditContextResolver,
  ) {
    this.#store = store;
    this.#scene = scene;
    this.#editContext = editContext;
    this.stateCell = computed(
      () => {
        const record = this.#store.cell.value.get(currentEditingId);
        if (record?.type !== "editing") return EMPTY_EDITING_STATE;
        if (record.suspended) return { nodeIds: NO_NODE_IDS, suspendedNodeIds: record.nodeIds };

        return { nodeIds: record.nodeIds, suspendedNodeIds: NO_NODE_IDS };
      },
      // Every store write reruns this; only a changed editing record should reach readers.
      { name: "editor.editing.state", equals: sameEditingState },
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
   * @returns a fresh snapshot array, empty while editing is suspended; mutating
   * it does not change editing scope.
   */
  get nodeIds(): readonly NodeId[] {
    return [...this.stateCell.peek().nodeIds];
  }

  /** Whether a node is in edit mode now; false for every node while editing is suspended. */
  has(nodeId: NodeId): boolean {
    return this.#nodeIds.peek().has(nodeId);
  }

  /** Whether any node is in edit mode now; false while editing is suspended. */
  hasScope(): boolean {
    return this.stateCell.peek().nodeIds.length > 0;
  }

  /**
   * Returns the edit context of the one node of `kind` in edit mode.
   *
   * @returns null with none or several such nodes, while editing is suspended,
   * or when the node's definition cannot give a context (a glyph not loaded).
   * @see {@link subject}
   */
  only<K extends NodeKind>(kind: K): EditContextOfKind<K> | null {
    return this.onlyCell(kind).peek();
  }

  /**
   * Reactive {@link only}: the edit context of the one node of `kind` in edit mode.
   *
   * @remarks
   * One cell per kind, created on first use. Readers rerun when editing scope,
   * the scene's nodes, or what the context reads changes.
   */
  onlyCell<K extends NodeKind>(kind: K): Signal<EditContextOfKind<K> | null> {
    let cell = this.#onlyCellsByKind.get(kind);
    if (!cell) {
      cell = computed(() => this.#soleContext(this.stateCell.value.nodeIds, kind), {
        name: `editor.editing.only.${kind}`,
        equals: sameContext,
      });
      this.#onlyCellsByKind.set(kind, cell);
    }

    return cell as Signal<EditContextOfKind<K> | null>;
  }

  /**
   * Returns the edit context of every node of `kind` in edit mode, in editing order.
   *
   * @returns a fresh array; empty while editing is suspended. Nodes whose
   * definition cannot give a context are left out.
   */
  of<K extends NodeKind>(kind: K): readonly EditContextOfKind<K>[] {
    return this.stateCell.peek().nodeIds.flatMap((nodeId) => {
      const context = this.#contextOf(nodeId, kind);
      return context ? [context] : [];
    });
  }

  /**
   * Returns the edit context of the node of `kind` this session is about, even
   * while editing is suspended.
   *
   * @remarks
   * That is the one node of `kind` in edit mode or suspended from it; when
   * neither holds a node of `kind` (nothing entered, or the suspended node was
   * replaced), the scene's one node of `kind`. Use it for displays and the
   * setters they write through; use {@link only} for tools and commands that
   * must do nothing while editing is suspended.
   *
   * @returns null when no single node of `kind` qualifies.
   */
  subject<K extends NodeKind>(kind: K): EditContextOfKind<K> | null {
    return this.subjectCell(kind).peek();
  }

  /**
   * Reactive {@link subject}. One cell per kind, created on first use.
   */
  subjectCell<K extends NodeKind>(kind: K): Signal<EditContextOfKind<K> | null> {
    let cell = this.#subjectCellsByKind.get(kind);
    if (!cell) {
      cell = computed(() => this.#subjectContext(kind), {
        name: `editor.editing.subject.${kind}`,
        equals: sameContext,
      });
      this.#subjectCellsByKind.set(kind, cell);
    }

    return cell as Signal<EditContextOfKind<K> | null>;
  }

  enter(nodeId: NodeId): void {
    this.set([nodeId]);
  }

  /** Puts exactly these nodes in edit mode, ending any suspension. */
  set(nodeIds: readonly NodeId[]): void {
    this.#write(uniqueInOrder(nodeIds), false);
  }

  /**
   * Suspends editing until the returned function restores it.
   *
   * @remarks
   * For modes that show glyphs as plain content (Hand, Text). While
   * suspended, {@link only}, {@link of} and {@link has} answer as if nothing
   * were edited, and {@link subject} still names the suspended node. The
   * restore skips nodes deleted in the meantime.
   *
   * @returns a function that re-enters the suspended nodes.
   */
  suspend(): () => void {
    const { nodeIds, suspendedNodeIds } = this.stateCell.peek();
    if (nodeIds.length > 0) this.#write(nodeIds, true);

    const suspended = nodeIds.length > 0 ? nodeIds : suspendedNodeIds;
    return () => this.set(suspended.filter((id) => this.#store.get(id)?.type === "node"));
  }

  /** Leaves every edited node, including suspended ones. */
  clear(): void {
    if (!this.#store.get(currentEditingId)) return;

    this.#store.delete(currentEditingId);
  }

  #subjectContext<K extends NodeKind>(kind: K): EditContextOfKind<K> | null {
    track(this.stateCell);
    track(this.#scene.cell);
    const { nodeIds, suspendedNodeIds } = this.stateCell.peek();
    const editedIds = nodeIds.length > 0 ? nodeIds : suspendedNodeIds;
    const edited = editedIds.filter((id) => this.#scene.nodeOfKind(id, kind) !== null);
    if (edited.length > 0) return this.#soleContext(edited, kind);

    const node = this.#scene.only(kind);
    return node ? this.#contextFor<K>(node) : null;
  }

  /** The context of the one node of `kind` among `nodeIds`; reactive when called from a computed. */
  #soleContext<K extends NodeKind>(
    nodeIds: readonly NodeId[],
    kind: K,
  ): EditContextOfKind<K> | null {
    track(this.#scene.cell);
    const nodes = nodeIds.filter((id) => this.#scene.nodeOfKind(id, kind) !== null);
    const [nodeId] = nodes;
    if (nodes.length !== 1 || !nodeId) return null;

    return this.#contextOf(nodeId, kind);
  }

  #contextOf<K extends NodeKind>(nodeId: NodeId, kind: K): EditContextOfKind<K> | null {
    const node = this.#scene.nodeOfKind(nodeId, kind);
    return node ? this.#contextFor<K>(node) : null;
  }

  #contextFor<K extends NodeKind>(node: ShiftNode): EditContextOfKind<K> | null {
    return this.#editContext(node) as EditContextOfKind<K> | null;
  }

  #write(nodeIds: readonly NodeId[], suspended: boolean): void {
    if (nodeIds.length === 0) {
      this.clear();
      return;
    }

    this.#store.put({
      id: currentEditingId,
      type: "editing",
      scope: "session",
      nodeIds,
      suspended,
    });
  }
}

function sameEditingState(a: EditingState, b: EditingState): boolean {
  return a.nodeIds === b.nodeIds && a.suspendedNodeIds === b.suspendedNodeIds;
}

/** Compares contexts field by field, so a rebuilt context over the same objects reads as unchanged. */
function sameContext(a: NodeEditContext | null, b: NodeEditContext | null): boolean {
  if (a === null || b === null) return a === b;

  const left = Object.entries(a);
  const right = new Map(Object.entries(b));
  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && Object.is(right.get(key), value))
  );
}
