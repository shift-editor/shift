import { computed, signal, type Signal } from "../signals";

/**
 * Renderer-owned state shown with the open edit's preview over it.
 *
 * @remarks
 * The base state is the font as the window's engine left it, so a committed
 * edit is already in it; only an edit still being dragged is previewed here.
 * One edit at a time may be open, like a glyph layer's edit slot.
 *
 * @typeParam T - The state, immutable.
 * @typeParam E - One edit; `apply` applies a list of them in order.
 */
export class PreviewedState<T, E> {
  /** The open edit's preview, or null when no edit is open. */
  readonly #preview = signal<readonly E[] | null>(null, { name: "previewedState.preview" });
  readonly #visible: Signal<T>;

  /**
   * @param base - The state as the engine left it.
   * @param apply - Returns `state` with `edits` applied in order, sharing what it can.
   */
  constructor(base: Signal<T>, apply: (state: T, edits: readonly E[]) => T) {
    this.#visible = computed(() => {
      const preview = this.#preview.value;
      return preview && preview.length > 0 ? apply(base.value, preview) : base.value;
    });
  }

  /** The state readers see: the base, then the open edit's preview. */
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

  /** Closes the open edit: committed, so the base now has it, or abandoned. */
  endEdit(): void {
    this.#preview.set(null);
  }
}
