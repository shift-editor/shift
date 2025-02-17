import { EventEmitter } from "@/lib/core/EventEmitter";

describe("EventEmitter", () => {
  it("should emit events", () => {
    const emitter = new EventEmitter();

    const handler = jest.fn();

    emitter.on("point:added", handler);

    emitter.emit("point:added");

    expect(handler).toHaveBeenCalled();
  });

  it("should call multiple handlers", () => {
    const emitter = new EventEmitter();

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    emitter.on("point:added", handler1);
    emitter.on("point:added", handler2);

    emitter.emit("point:added");

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should remove event handlers", () => {
    const emitter = new EventEmitter();

    const handler = jest.fn();

    emitter.on("point:added", handler);

    emitter.off("point:added", handler);

    emitter.emit("point:added");

    expect(handler).not.toHaveBeenCalled();
  });
});
