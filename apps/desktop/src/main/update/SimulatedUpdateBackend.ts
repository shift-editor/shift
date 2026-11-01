import { app } from "electron";
import type { UpdateBackend, UpdateBackendEvents } from "./types";

const SIMULATED_VERSION = "9.9.9";
const PROGRESS_STEP = 4;
const PROGRESS_INTERVAL_MS = 300;

/**
 * Pretends a newer version exists, for trying the update strip in `pnpm dev`.
 *
 * @remarks
 * Enabled by `SHIFT_SIMULATE_UPDATE=1` in unpackaged builds only. The download
 * counts to 100% over about eight seconds, and installing relaunches the same build.
 */
export class SimulatedUpdateBackend implements UpdateBackend {
  #events: UpdateBackendEvents | null = null;

  listen(events: UpdateBackendEvents): void {
    this.#events = events;
  }

  async check(): Promise<void> {
    this.#events?.available(SIMULATED_VERSION);
  }

  async download(): Promise<void> {
    for (let percent = 0; percent < 100; percent += PROGRESS_STEP) {
      this.#events?.progress(percent);
      await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS));
    }
    this.#events?.progress(100);
    this.#events?.downloaded();
  }

  install(): void {
    app.relaunch();
    app.quit();
  }
}
