import { describe, expect, it } from "vitest";
import { SerialRequest } from "./SerialRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function serial() {
  const pending = new Map<string, ReturnType<typeof deferred<string>>>();
  const sent: string[] = [];
  const results: string[] = [];
  const requests = new SerialRequest<string, string>(
    (request) => {
      sent.push(request);
      const next = deferred<string>();
      pending.set(request, next);
      return next.promise;
    },
    (request, result) => results.push(`${request}:${result}`),
    () => {},
  );
  const settle = async (request: string) => {
    pending.get(request)!.resolve(request.toLowerCase());
    await Promise.resolve();
    await Promise.resolve();
  };
  return { requests, sent, results, settle };
}

describe("serial asynchronous requests", () => {
  it("sends the first and the newest of a burst, never two at once", async () => {
    const { requests, sent, results, settle } = serial();
    requests.request("A");
    requests.request("B");
    requests.request("C");
    expect(sent).toEqual(["A"]);

    await settle("A");
    expect(sent).toEqual(["A", "C"]);
    await settle("C");
    expect(results).toEqual(["A:a", "C:c"]);
  });

  it("delivers nothing after disposal", async () => {
    const { requests, sent, results, settle } = serial();
    requests.request("A");
    requests.request("B");
    requests.dispose();

    await settle("A");
    expect(sent).toEqual(["A"]);
    expect(results).toEqual([]);
  });
});
