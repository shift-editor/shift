import type { KerningValueEdit } from "@shift/types";
import type { WorkspaceEditCoordinator } from "../../types/font";
import type { Kerning } from "./Kerning";
import type { PendingState } from "./PendingState";

/**
 * One reversible preview and commit cycle that sets or removes kerning values.
 *
 * @remarks
 * Like a sidebearing edit: previews show at once through the font's kerning,
 * and committing submits one undoable `setKerningValues` intent whose values
 * stay visible until the workspace confirms them. Construction opens the
 * kerning's single edit slot; finish with {@link commit} or {@link discard}.
 */
export class KerningEdit {
  readonly #state: PendingState<Kerning, KerningValueEdit>;
  readonly #coordinator: WorkspaceEditCoordinator;

  #edits: readonly KerningValueEdit[] = [];
  #closed = false;

  /** @throws {Error} When another kerning edit is open. */
  constructor(
    state: PendingState<Kerning, KerningValueEdit>,
    coordinator: WorkspaceEditCoordinator,
  ) {
    this.#state = state;
    this.#coordinator = coordinator;
    state.beginEdit();
  }

  /** Shows `edits` in place of the last preview; an edit without an amount removes its pair. */
  preview(edits: readonly KerningValueEdit[]): void {
    if (this.#closed) throw new Error("kerning edit is closed");
    this.#edits = [...edits];
    this.#state.preview(this.#edits);
  }

  /** Commits the latest preview as one undo step; an empty preview commits nothing. */
  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    const edits = this.#edits;
    if (edits.length === 0) {
      this.#state.cancelEdit();
      return;
    }

    try {
      const editId = this.#coordinator.transaction(label, () =>
        this.#coordinator.push({
          kind: "setKerningValues",
          setKerningValues: { edits: [...edits] },
        }),
      );
      this.#state.finishEdit(editId, edits);
    } catch (error) {
      this.#state.cancelEdit();
      throw error;
    }
  }

  /** Closes the edit and restores the kerning it previewed over. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }
}
