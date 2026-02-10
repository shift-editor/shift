type FrameHandlerCallback = (...args: unknown[]) => void;

/**
 * Deduplicates `requestAnimationFrame` calls for a single render target.
 *
 * Multiple redraw requests between frames are coalesced into one callback.
 * Only the most recently supplied callback is invoked; earlier ones are
 * silently dropped. This prevents redundant work when editor state changes
 * several times within a single frame.
 */
export class FrameHandler {
  #id: number | null = null;
  #callback: FrameHandlerCallback | null = null;

  /** Schedules `callback` on the next animation frame. No-ops if a frame is already pending. */
  public requestUpdate(callback: FrameHandlerCallback): void {
    if (this.#id) return;
    this.#callback = callback;

    this.#id = window.requestAnimationFrame(this.#update);
  }

  #update = () => {
    if (!this.#callback) return;
    this.#callback();
    this.#callback = null;
    this.#id = null;
  };

  cleanup(): void {
    if (!this.#id) return;
    window.cancelAnimationFrame(this.#id);
    this.#id = null;
    this.#callback = null;
  }

  /** Cancels any pending animation frame and clears the stored callback. */
  public cancelUpdate(): void {
    this.cleanup();
  }
}
