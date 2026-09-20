import type { LatestRequestResult } from "@/types/request";

/** Allows only the latest asynchronous request to publish its result. */
export class LatestRequest {
  #generation = 0;

  /**
   * Runs work and marks its result stale when superseded or invalidated.
   *
   * @param load - Asynchronous work started for this request generation.
   * @returns The value only while this request remains current.
   */
  async run<T>(load: () => Promise<T>): Promise<LatestRequestResult<T>> {
    const generation = ++this.#generation;
    const value = await load();
    if (generation !== this.#generation) return { status: "stale" };

    return { status: "current", result: value };
  }

  /** Invalidates every request that began before this call. */
  invalidate(): void {
    this.#generation++;
  }
}
