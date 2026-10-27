import { describe, it, expect } from "vitest";
import { EventEmitter } from "./lifecycle";

describe("EventEmitter", () => {
  it("delivers an emitted event to a registered handler", () => {
    const lifecycle = new EventEmitter();
    let fires = 0;

    lifecycle.on("destroying", () => fires++);
    lifecycle.emit("destroying");

    expect(fires).toBe(1);
  });

  it("delivers to every handler registered for the same event", () => {
    const lifecycle = new EventEmitter();
    let aFires = 0;
    let bFires = 0;

    lifecycle.on("destroying", () => aFires++);
    lifecycle.on("destroying", () => bFires++);
    lifecycle.emit("destroying");

    expect(aFires).toBe(1);
    expect(bFires).toBe(1);
  });

  it("unsubscribes via the returned disposer", () => {
    const lifecycle = new EventEmitter();
    let fires = 0;

    const off = lifecycle.on("destroying", () => fires++);
    off();
    lifecycle.emit("destroying");

    expect(fires).toBe(0);
  });

  it("dispose clears every listener", () => {
    const lifecycle = new EventEmitter();
    let fires = 0;

    lifecycle.on("destroying", () => fires++);
    lifecycle.dispose();
    lifecycle.emit("destroying");

    expect(fires).toBe(0);
  });

  it("emitting with no listeners does not throw", () => {
    const lifecycle = new EventEmitter();

    expect(() => lifecycle.emit("destroying")).not.toThrow();
  });
});
