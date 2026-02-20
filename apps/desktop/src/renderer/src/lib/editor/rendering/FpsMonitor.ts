import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";

const UPDATE_INTERVAL_MS = 250;

/**
 * Measures the browser's actual frame rate using a rolling one-second window.
 *
 * Exposes the current FPS as a reactive signal, updated at most every
 * {@link UPDATE_INTERVAL_MS} to avoid excessive signal notifications.
 * Start/stop the monitor when the debug overlay is toggled.
 */
export class FpsMonitor {
  readonly #fps: WritableSignal<number>;
  #timestamps: number[] = [];
  #rafId: number | null = null;
  #running: boolean = false;
  #lastUpdateTime: number = 0;

  constructor() {
    this.#fps = signal(0);
  }

  /** Reactive read-only signal holding the current frames-per-second count. */
  get fps(): Signal<number> {
    return this.#fps;
  }

  /** Begins sampling frames. Safe to call if already running. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timestamps = [];
    this.#lastUpdateTime = 0;
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  /** Stops sampling frames, cancels the pending rAF, and resets the FPS signal to 0. */
  stop(): void {
    this.#running = false;
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#timestamps = [];
    this.#fps.set(0);
  }

  #tick = (timestamp: DOMHighResTimeStamp): void => {
    if (!this.#running) return;

    const oneSecondAgo = timestamp - 1000;
    while (this.#timestamps.length > 0 && this.#timestamps[0] <= oneSecondAgo) {
      this.#timestamps.shift();
    }

    this.#timestamps.push(timestamp);

    if (timestamp - this.#lastUpdateTime >= UPDATE_INTERVAL_MS) {
      this.#fps.set(this.#timestamps.length);
      this.#lastUpdateTime = timestamp;
    }

    this.#rafId = requestAnimationFrame(this.#tick);
  };
}
