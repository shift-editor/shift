type FrameHandlerCallback = (...args: unknown[]) => void;

/** The clock that runs frames; defaults to the browser's animation frames. */
export interface FrameClock {
  request(callback: () => void): number;
  cancel(id: number): void;
}

const animationFrames: FrameClock = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (id) => window.cancelAnimationFrame(id),
};

/**
 * Deduplicates `requestAnimationFrame` calls for a single render target.
 *
 * Multiple redraw requests between frames are coalesced into one callback.
 * Only the first supplied callback is invoked; requests made while a frame
 * is pending are dropped, but a request made while the frame's callback runs
 * schedules the next frame. This prevents redundant work when editor
 * state changes several times within a single frame.
 */
export class FrameHandler {
  readonly #clock: FrameClock;
  #id: number | null = null;
  #callback: FrameHandlerCallback | null = null;

  constructor(clock: FrameClock = animationFrames) {
    this.#clock = clock;
  }

  /** Schedules `callback` on the next animation frame. No-ops if a frame is already pending. */
  public requestUpdate(callback: FrameHandlerCallback): void {
    if (this.#id) return;
    this.#callback = callback;

    this.#id = this.#clock.request(this.#update);
  }

  #update = () => {
    const callback = this.#callback;
    // Clear before running: a redraw requested during the callback must get its own frame, and a
    // callback that throws must not leave this target permanently "pending".
    this.#callback = null;
    this.#id = null;
    if (callback) callback();
  };

  cleanup(): void {
    if (!this.#id) return;
    this.#clock.cancel(this.#id);
    this.#id = null;
    this.#callback = null;
  }

  /** Cancels any pending animation frame and clears the stored callback. */
  public cancelUpdate(): void {
    this.cleanup();
  }
}
