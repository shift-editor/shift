/**
 * Whether a font takes edits. A preview's font refuses them: an edit
 * changes nothing and says it was refused, so the editor can tell the user
 * the font is read-only. Every other font takes them.
 *
 * @remarks
 * Layer writers ask the gate where an edit would leave them for the
 * window's engine, so whatever a tool does on the way (selecting, hovering,
 * opening glyphs) runs as in any font, and only the change is refused.
 */
export class EditGate {
  // non-reactive: set once when a preview's editor opens; read where an edit is sent
  #onRefused: (() => void) | null = null;
  // non-reactive: how many test fixtures are writing through the gate now
  #held = 0;
  // non-reactive: whether a refusal was already reported in this task
  #reported = false;

  /** Whether edits are refused now. */
  get closed(): boolean {
    return this.#onRefused !== null && this.#held === 0;
  }

  /** Refuses every edit from now on, calling `onRefused` when one is tried. */
  refuse(onRefused: () => void): void {
    this.#onRefused = onRefused;
  }

  /**
   * Whether an edit about to be sent must not be, reporting it when so. One
   * action sends several edits; it is reported once.
   */
  refuses(): boolean {
    const onRefused = this.#onRefused;
    if (!onRefused || this.#held > 0) return false;
    if (!this.#reported) {
      this.#reported = true;
      queueMicrotask(() => (this.#reported = false));
      onRefused();
    }
    return true;
  }

  /**
   * Runs `body` with edits taken, for a test that builds a preview's font
   * before looking at it. Not for production code.
   */
  async whileOpen<T>(body: () => Promise<T>): Promise<T> {
    this.#held++;
    try {
      return await body();
    } finally {
      this.#held--;
    }
  }
}
