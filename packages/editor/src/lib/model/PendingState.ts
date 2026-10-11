import type { PendingEditId } from "../../types/editing";
import { computed, signal, type Signal } from "../signals";

/**
 * Renderer-owned state that shows local edits before the workspace confirms
 * them.
 *
 * @remarks
 * The visible state is the confirmed state (the latest workspace echo) with
 * every pending edit replayed over it in submit order, then the open edit's
 * preview. It suits edits that are idempotent sets, such as kerning values:
 * replaying an edit the echo already includes changes nothing, so an echo
 * can update the confirmed state while later edits are still pending, and a
 * change from elsewhere (an undo, an agent) shows at once.
 *
 * Each pending edit is keyed by the coordinator's {@link PendingEditId} and
 * leaves when its echo is confirmed or it is rolled back. One edit at a time
 * may be open for previewing, like a glyph layer's local-edit slot.
 *
 * @typeParam T - The state, immutable.
 * @typeParam E - One edit; `apply` replays a list of them in order.
 */
export class PendingState<T, E> {
  readonly #pending = signal<ReadonlyMap<PendingEditId, readonly E[]>>(new Map(), {
    name: "pendingState.pending",
  });
  /** The open edit's preview, or null when no edit is open. */
  readonly #preview = signal<readonly E[] | null>(null, { name: "pendingState.preview" });
  readonly #visible: Signal<T>;

  /**
   * @param confirmed - The workspace's state, updated by its echoes.
   * @param apply - Returns `state` with `edits` applied in order, sharing what it can.
   */
  constructor(confirmed: Signal<T>, apply: (state: T, edits: readonly E[]) => T) {
    this.#visible = computed(() => {
      const edits = [...this.#pending.value.values()].flat();
      const preview = this.#preview.value;
      if (preview) edits.push(...preview);
      return edits.length === 0 ? confirmed.value : apply(confirmed.value, edits);
    });
  }

  /** The state readers see: confirmed, pending, then the open preview. */
  get cell(): Signal<T> {
    return this.#visible;
  }

  /**
   * Opens an edit for previewing.
   *
   * @throws {Error} When an edit is already open.
   */
  beginEdit(): void {
    if (this.#preview.peek() !== null) throw new Error("an edit is already open");
    this.#preview.set([]);
  }

  /** Shows `edits` as the open edit's preview, replacing the last one. */
  preview(edits: readonly E[]): void {
    if (this.#preview.peek() === null) throw new Error("no edit is open to preview");
    this.#preview.set(edits);
  }

  /** Closes the open edit, its `edits` now pending under `editId` until confirmed. */
  finishEdit(editId: PendingEditId, edits: readonly E[]): void {
    this.#preview.set(null);
    const pending = new Map(this.#pending.peek());
    pending.set(editId, [...(pending.get(editId) ?? []), ...edits]);
    this.#pending.set(pending);
  }

  /** Closes the open edit without keeping it. */
  cancelEdit(): void {
    this.#preview.set(null);
  }

  /** Drops an edit whose echo the confirmed state now includes. */
  confirm(editId: PendingEditId): void {
    this.#drop(editId);
  }

  /** Drops an edit the workspace rejected; the confirmed state never had it. */
  rollback(editId: PendingEditId): void {
    this.#drop(editId);
  }

  /** Drops every pending edit and any open preview, as after a resync. */
  reset(): void {
    this.#pending.set(new Map());
    this.#preview.set(null);
  }

  #drop(editId: PendingEditId): void {
    const current = this.#pending.peek();
    if (!current.has(editId)) return;
    const pending = new Map(current);
    pending.delete(editId);
    this.#pending.set(pending);
  }
}
