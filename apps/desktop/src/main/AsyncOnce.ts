/** Retains one asynchronous result until explicitly reset. */
export class AsyncOnce<Result> {
  #promise: Promise<Result> | null = null;

  /**
   * Starts work when empty and otherwise returns the retained promise.
   *
   * @param work - operation retained through pending, fulfilled, or rejected settlement.
   * @returns the exact retained promise shared by every caller before reset.
   */
  run(work: () => Result | PromiseLike<Result>): Promise<Result> {
    if (this.#promise) return this.#promise;

    this.#promise = Promise.resolve().then(work);
    return this.#promise;
  }

  /** Returns the one-shot to empty without altering a retained promise's settlement. */
  reset(): void {
    this.#promise = null;
  }
}
