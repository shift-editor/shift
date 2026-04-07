import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "./lifecycle";

describe("EventEmitter", () => {
  it("calls handler when event is emitted", () => {
    const lifecycle = new EventEmitter();
    const handler = vi.fn();

    lifecycle.on("fontLoaded", handler);
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ font: {} });
  });

  it("calls multiple handlers for the same event", () => {
    const lifecycle = new EventEmitter();
    const a = vi.fn();
    const b = vi.fn();

    lifecycle.on("fontLoaded", a);
    lifecycle.on("fontLoaded", b);
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("does not call handlers for other events", () => {
    const lifecycle = new EventEmitter();
    const handler = vi.fn();

    lifecycle.on("fontSaved", handler);
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes via returned disposer", () => {
    const lifecycle = new EventEmitter();
    const handler = vi.fn();

    const off = lifecycle.on("fontLoaded", handler);
    off();
    lifecycle.emit("fontLoaded", { font: {} as never });

    expect(handler).not.toHaveBeenCalled();
  });

  it("handles events with no payload", () => {
    const lifecycle = new EventEmitter();
    const handler = vi.fn();

    lifecycle.on("destroying", handler);
    lifecycle.emit("destroying");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("dispose removes all listeners", () => {
    const lifecycle = new EventEmitter();
    const a = vi.fn();
    const b = vi.fn();

    lifecycle.on("fontLoaded", a);
    lifecycle.on("destroying", b);
    lifecycle.dispose();

    lifecycle.emit("fontLoaded", { font: {} as never });
    lifecycle.emit("destroying");

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("emitting with no listeners does not throw", () => {
    const lifecycle = new EventEmitter();

    expect(() => lifecycle.emit("fontLoaded", { font: {} as never })).not.toThrow();
  });
});
