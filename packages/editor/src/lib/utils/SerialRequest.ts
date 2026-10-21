/**
 * Sends asynchronous requests one at a time, keeping only the newest waiting.
 *
 * @remarks
 * While a request is in flight, a newer one replaces any request already
 * waiting, so a burst of requests sends the first and the last. Unlike
 * {@link LatestRequest}, which lets requests overlap and drops stale results,
 * this never has more than one request outstanding; every result is
 * delivered, and the receiver decides whether it is still current.
 */
export class SerialRequest<Request, Result> {
  readonly #send: (request: Request) => Promise<Result>;
  readonly #onResult: (request: Request, result: Result) => void;
  readonly #onError: (error: unknown) => void;
  #inFlight = false;
  #waiting: Request | null = null;
  #disposed = false;
  // non-reactive: resolvers for settled() callers, drained when the queue empties
  #idle: (() => void)[] = [];

  /**
   * @param send - Starts one request.
   * @param onResult - Receives each result, with the request it answers; not called after disposal.
   * @param onError - Receives a failed request's error; the next waiting request is still sent.
   */
  constructor(
    send: (request: Request) => Promise<Result>,
    onResult: (request: Request, result: Result) => void,
    onError: (error: unknown) => void,
  ) {
    this.#send = send;
    this.#onResult = onResult;
    this.#onError = onError;
  }

  /** Sends the request now, or after the one in flight, replacing any waiting request. */
  request(request: Request): void {
    if (this.#disposed) return;
    if (this.#inFlight) {
      this.#waiting = request;
      return;
    }
    void this.#run(request);
  }

  /**
   * Resolves once no request is in flight or waiting, including any queued
   * while this one was outstanding.
   */
  settled(): Promise<void> {
    if (!this.#inFlight) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  /** Drops the waiting request and any result still to arrive. */
  dispose(): void {
    this.#disposed = true;
    this.#waiting = null;
    this.#resolveIdle();
  }

  async #run(request: Request): Promise<void> {
    this.#inFlight = true;
    try {
      const result = await this.#send(request);
      if (!this.#disposed) this.#onResult(request, result);
    } catch (error) {
      if (!this.#disposed) this.#onError(error);
    } finally {
      this.#inFlight = false;
      const next = this.#waiting;
      this.#waiting = null;
      if (next !== null && !this.#disposed) void this.#run(next);
      else this.#resolveIdle();
    }
  }

  #resolveIdle(): void {
    const idle = this.#idle;
    this.#idle = [];
    for (const resolve of idle) resolve();
  }
}
