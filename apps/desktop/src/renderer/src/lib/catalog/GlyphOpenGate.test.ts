import { describe, expect, it } from "vitest";
import { GlyphOpenGate } from "./GlyphOpenGate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("latest glyph-open publication", () => {
  it("rejects an older glyph that resolves after the current request", async () => {
    const gate = new GlyphOpenGate();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstResult = gate.open(() => first.promise);
    const secondResult = gate.open(() => second.promise);

    second.resolve("B");
    expect(await secondResult).toEqual({ status: "current", glyph: "B" });
    first.resolve("A");
    expect(await firstResult).toEqual({ status: "stale" });
  });

  it("rejects a request invalidated while leaving the glyph route", async () => {
    const gate = new GlyphOpenGate();
    const pending = deferred<string>();
    const result = gate.open(() => pending.promise);

    gate.invalidate();
    pending.resolve("A");
    expect(await result).toEqual({ status: "stale" });
  });
});
