/**
 * Owns one open user-action capture spanning renderer and document changes.
 *
 * @remarks
 * `finish()` records the net editor diff and attached document operation.
 * `discard()` restores the starting editor values and records nothing. Both
 * terminal calls are idempotent; a finished or discarded capture cannot reopen.
 */
export class HistoryCapture {
  readonly #finishCapture: () => void;
  readonly #discardCapture: () => void;
  #status: "open" | "finished" | "discarded" = "open";

  /**
   * @param finishCapture - Publishes the completed action once.
   * @param discardCapture - Restores the action's starting editor values once.
   */
  constructor(finishCapture: () => void, discardCapture: () => void) {
    this.#finishCapture = finishCapture;
    this.#discardCapture = discardCapture;
  }

  finish(): void {
    if (this.#status !== "open") return;

    this.#status = "finished";
    this.#finishCapture();
  }

  discard(): void {
    if (this.#status !== "open") return;

    this.#status = "discarded";
    this.#discardCapture();
  }
}
