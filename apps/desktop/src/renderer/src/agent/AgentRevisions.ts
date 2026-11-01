import { FontChangedError, type FontRevision, type ShiftObservation } from "@shift/runtime";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

/**
 * The font revision agents see for one window, and the guard every agent
 * call runs under: reads observe one revision, writes check it first.
 *
 * @remarks
 * A revision is this renderer's authored-revision count under a namespace
 * minted per instance, so a token from another window or an earlier renderer
 * never matches. Only edits that change the font advance it; proof text and
 * other scene edits do not.
 */
export class AgentRevisions {
  readonly #edits: WorkspaceEditCoordinator | null;
  readonly #namespace = crypto.randomUUID();

  /**
   * @param edits - The workspace's edit coordinator; null for a session
   * without a workspace, whose revision never moves.
   */
  constructor(edits: WorkspaceEditCoordinator | null) {
    this.#edits = edits;
  }

  /** The revision now, without waiting for pending edits. */
  current(): FontRevision {
    const sequence = this.#edits?.authoredRevisionCell.peek() ?? 0;
    return `${this.#namespace}:${sequence}`;
  }

  /**
   * Runs `read` against one revision once pending edits settle, retrying
   * once when an edit lands while it runs.
   *
   * @throws {Error} when `ifFontRevision` is not the revision now, or the font
   * keeps changing.
   */
  async observe<Value>(
    ifFontRevision: FontRevision | undefined,
    read: () => Value | Promise<Value>,
  ): Promise<ShiftObservation<Value>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.#edits?.settled();
      const before = this.current();
      this.#assertRevision(ifFontRevision, before);

      const value = await read();
      await this.#edits?.settled();
      const after = this.current();
      if (before === after) return { fontRevision: before, value };
      if (ifFontRevision) this.#assertRevision(ifFontRevision, after);
    }

    throw new Error("The font changed while Shift was reading it; retry the observation");
  }

  /**
   * Runs `write` once pending edits settle and `ifFontRevision`, when given,
   * still matches, then answers with the revision it settled at.
   *
   * @remarks
   * The check and the start of `write` run in one turn, so no edit lands
   * between them. A write that changes no font data, as proof text does,
   * answers with the revision it was checked against.
   *
   * @throws {FontChangedError} when `ifFontRevision` no longer matches; `write`
   * has not run.
   */
  async write<Value>(
    ifFontRevision: FontRevision | undefined,
    write: () => Promise<Value>,
  ): Promise<ShiftObservation<Value>> {
    await this.#edits?.settled();
    const current = this.current();
    if (ifFontRevision !== undefined && ifFontRevision !== current) {
      throw new FontChangedError(
        ifFontRevision,
        current,
        `The font changed (expected revision ${ifFontRevision}, now ${current}); nothing was written`,
      );
    }

    const value = await write();
    await this.#edits?.settled();
    return { fontRevision: this.current(), value };
  }

  #assertRevision(expected: FontRevision | undefined, current: FontRevision): void {
    if (!expected || expected === current) return;
    throw new Error(`Font revision mismatch: expected ${expected}, current ${current}`);
  }
}
