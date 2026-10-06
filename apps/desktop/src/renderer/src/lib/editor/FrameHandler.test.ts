import { beforeEach, describe, expect, it } from "vitest";
import { FrameHandler, type FrameClock } from "@shift/editor/rendering";

describe("FrameHandler", () => {
  let frames: (() => void)[];
  const clock: FrameClock = {
    request: (callback) => frames.push(callback),
    cancel: () => {},
  };

  function runFrame(): void {
    const pending = frames;
    frames = [];
    for (const frame of pending) frame();
  }

  beforeEach(() => {
    frames = [];
  });

  it("schedules a redraw requested while the current frame's callback runs", () => {
    const handler = new FrameHandler(clock);
    const drawn: string[] = [];

    handler.requestUpdate(() => {
      drawn.push("first");
      handler.requestUpdate(() => drawn.push("second"));
    });
    runFrame();
    runFrame();

    expect(drawn).toEqual(["first", "second"]);
  });

  it("keeps scheduling after a frame's callback throws", () => {
    const handler = new FrameHandler(clock);
    const drawn: string[] = [];

    handler.requestUpdate(() => {
      throw new Error("draw failed");
    });
    expect(runFrame).toThrow("draw failed");

    handler.requestUpdate(() => drawn.push("recovered"));
    runFrame();

    expect(drawn).toEqual(["recovered"]);
  });
});
