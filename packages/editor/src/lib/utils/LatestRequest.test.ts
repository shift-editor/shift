import { describe, expect, it } from "vitest";
import { LatestRequest } from "./LatestRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("latest asynchronous request publication", () => {
  it("rejects an older result that resolves after the current request", async () => {
    const latest = new LatestRequest();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstResult = latest.run(() => first.promise);
    const secondResult = latest.run(() => second.promise);

    second.resolve("B");
    expect(await secondResult).toEqual({ status: "current", result: "B" });
    first.resolve("A");
    expect(await firstResult).toEqual({ status: "stale" });
  });

  it("rejects a request invalidated before it resolves", async () => {
    const latest = new LatestRequest();
    const pending = deferred<string>();
    const result = latest.run(() => pending.promise);

    latest.invalidate();
    pending.resolve("A");
    expect(await result).toEqual({ status: "stale" });
  });
});
