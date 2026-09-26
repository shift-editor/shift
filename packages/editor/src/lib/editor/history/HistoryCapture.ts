/**
 * Owns one explicit user-action capture until it is finished or cancelled.
 *
 * @remarks
 * `finish()` stores the action's net record changes synchronously. `cancel()`
 * restores its starting editor records unless a document edit already committed.
 * Both terminal operations are idempotent.
 */
export class HistoryCapture {
  readonly #finishCapture: () => void;
  readonly #cancelCapture: () => void;
  #status: "open" | "finished" | "cancelled" = "open";

  /**
   * Creates a capture handle around history-owned terminal callbacks.
   *
   * @param finishCapture - Seals the completed action exactly once.
   * @param cancelCapture - Cancels the action exactly once.
   */
  constructor(finishCapture: () => void, cancelCapture: () => void) {
    this.#finishCapture = finishCapture;
    this.#cancelCapture = cancelCapture;
  }

  /** Seals and records the action's net effects. Idempotent. */
  finish(): void {
    if (this.#status !== "open") return;

    this.#status = "finished";
    this.#finishCapture();
  }

  /** Cancels the action and restores its editor records. Idempotent. */
  cancel(): void {
    if (this.#status !== "open") return;

    this.#status = "cancelled";
    this.#cancelCapture();
  }
}
