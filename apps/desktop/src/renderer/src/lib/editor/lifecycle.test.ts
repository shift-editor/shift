import { describe, it, expect } from "vitest";
import { EventEmitter } from "./lifecycle";

describe("EventEmitter", () => {
  it("delivers the emitted payload to a registered handler", () => {
    const lifecycle = new EventEmitter();
    const payloads: unknown[] = [];

    lifecycle.on("fontLoaded", (p) => payloads.push(p));
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(payloads).toEqual([{ font: {} }]);
  });

  it("delivers to every handler registered for the same event", () => {
    const lifecycle = new EventEmitter();
    const aPayloads: unknown[] = [];
    const bPayloads: unknown[] = [];

    lifecycle.on("fontLoaded", (p) => aPayloads.push(p));
    lifecycle.on("fontLoaded", (p) => bPayloads.push(p));
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(aPayloads).toEqual([{ font: {} }]);
    expect(bPayloads).toEqual([{ font: {} }]);
  });

  it("routes by event name so unrelated handlers do not fire", () => {
    const lifecycle = new EventEmitter();
    const saved: unknown[] = [];

    lifecycle.on("fontSaved", (p) => saved.push(p));
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(saved).toEqual([]);
  });

  it("unsubscribes via the returned disposer", () => {
    const lifecycle = new EventEmitter();
    const payloads: unknown[] = [];

    const off = lifecycle.on("fontLoaded", (p) => payloads.push(p));
    off();
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(payloads).toEqual([]);
  });

  it("delivers no-payload events", () => {
    const lifecycle = new EventEmitter();
    let fires = 0;

    lifecycle.on("destroying", () => fires++);
    lifecycle.emit("destroying");

    expect(fires).toBe(1);
  });

  it("dispose clears every listener across every event", () => {
    const lifecycle = new EventEmitter();
    const loaded: unknown[] = [];
    const destroying: unknown[] = [];

    lifecycle.on("fontLoaded", (p) => loaded.push(p));
    lifecycle.on("destroying", () => destroying.push(null));
    lifecycle.dispose();

    lifecycle.emit("fontLoaded", { font: {} as never });
    lifecycle.emit("destroying");

    expect(loaded).toEqual([]);
    expect(destroying).toEqual([]);
  });

  it("emitting with no listeners does not throw", () => {
    const lifecycle = new EventEmitter();

    expect(() => lifecycle.emit("fontLoaded", { font: {} as never })).not.toThrow();
  });
});
