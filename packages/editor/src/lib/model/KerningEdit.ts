import type { KerningValueEdit } from "@shift/types";
import type { OpenEdit, WorkspaceEditCoordinator } from "../../types/font";
import { setKerningValuesIntent } from "./Kerning";

/**
 * One reversible preview and commit cycle that sets or removes kerning values.
 *
 * @remarks
 * An open edit in the window's engine: each preview applies there at once,
 * replacing the last, so the engine's font is what the editor shows and every
 * kerning read sees it. Committing persists the latest preview as one undo
 * step; discarding returns the font to where the edit began. Construction
 * opens the edit; finish with {@link commit} or {@link discard}.
 */
export class KerningEdit {
  readonly #edit: OpenEdit;
  #edits: readonly KerningValueEdit[] = [];
  #closed = false;

  /** @throws {Error} When another edit or a transaction is open. */
  constructor(coordinator: WorkspaceEditCoordinator) {
    this.#edit = coordinator.openEdit();
  }

  /** Shows `edits` in place of the last preview; an edit without an amount removes its pair. */
  preview(edits: readonly KerningValueEdit[]): void {
    if (this.#closed) throw new Error("kerning edit is closed");
    this.#edits = [...edits];
    this.#edit.stage(this.#edits.length === 0 ? [] : [setKerningValuesIntent(this.#edits)]);
  }

  /** Commits the latest preview as one undo step; an empty preview commits nothing. */
  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#edit.commit(label);
  }

  /** Closes the edit and restores the kerning it previewed over. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#edit.cancel();
  }
}
