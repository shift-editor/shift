import { describe, expect, it } from "vitest";
import { clampHandleToFrame } from "./toolbarGeometry";

const FRAME = { width: 1000, height: 700 };

describe("keeping the handle inside the frame", () => {
  it("holds a handle that strays out at the inset", () => {
    expect(clampHandleToFrame({ x: 5000, y: -40 }, FRAME)).toEqual({ x: 988, y: 12 });
  });

  it("leaves a handle alone in a frame too small to inset it", () => {
    const handle = { x: 30, y: 5 };

    expect(clampHandleToFrame(handle, { width: 20, height: 20 })).toEqual(handle);
  });

  it("leaves a handle alone when it is inside", () => {
    const handle = { x: 600, y: 300 };

    expect(clampHandleToFrame(handle, FRAME)).toEqual(handle);
  });
});
