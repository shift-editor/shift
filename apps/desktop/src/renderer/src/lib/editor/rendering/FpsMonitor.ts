import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";

const UPDATE_INTERVAL_MS = 250;

export class FpsMonitor {
  readonly #fps: WritableSignal<number>;
  #timestamps: number[] = [];
  #rafId: number | null = null;
  #running: boolean = false;
  #lastUpdateTime: number = 0;

  constructor() {
    this.#fps = signal(0);
  }

  get fps(): Signal<number> {
    return this.#fps;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timestamps = [];
    this.#lastUpdateTime = 0;
    this.#rafId = requestAnimationFrame(this.#tick);
  }

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

  get isRunning(): boolean {
    return this.#running;
  }
}
