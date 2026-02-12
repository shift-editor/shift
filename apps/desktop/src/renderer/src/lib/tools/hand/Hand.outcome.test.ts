import { describe, it, expect, beforeEach } from "vitest";
import type { ToolEvent } from "../core/GestureDetector";
import { Hand } from "./Hand";
import { createMockToolContext, makeTestCoordinates } from "@/testing";

const p = { x: 0, y: 0 };
const coordsP = makeTestCoordinates(p);

function makeDragStart(): ToolEvent {
  return {
    type: "dragStart",
    point: p,
    coords: coordsP,
    screenPoint: p,
    shiftKey: false,
    altKey: false,
  };
}
function makeDrag(screenDelta: { x: number; y: number }): ToolEvent {
  return {
    type: "drag",
    point: p,
    coords: coordsP,
    screenPoint: p,
    origin: p,
    screenOrigin: p,
    delta: p,
    screenDelta,
    shiftKey: false,
    altKey: false,
  };
}
function makeDragEnd(): ToolEvent {
  return {
    type: "dragEnd",
    point: p,
    coords: coordsP,
    screenPoint: p,
    origin: p,
    screenOrigin: p,
  };
}
function makeDragCancel(): ToolEvent {
  return { type: "dragCancel" };
}

describe("Hand outcome", () => {
  let hand: Hand;

  beforeEach(() => {
    const ctx = createMockToolContext();
    hand = new Hand(ctx);
  });

  it("ready + dragStart -> dragging with screenStart and startPan from editor.pan", () => {
    const ready = { type: "ready" as const };
    const result = hand.transition(ready, makeDragStart());

    expect(result.type).toBe("dragging");
    if (result.type === "dragging") {
      expect(result.screenStart).toEqual(p);
      expect(result.startPan).toBeDefined();
      expect(typeof result.startPan.x).toBe("number");
      expect(typeof result.startPan.y).toBe("number");
    }
  });

  it("dragging + drag -> same state (pan/redraw side effect only)", () => {
    const dragging = { type: "dragging" as const, screenStart: p, startPan: { x: 10, y: 20 } };
    const result = hand.transition(dragging, makeDrag({ x: 5, y: 5 }));

    expect(result.type).toBe("dragging");
    if (result.type === "dragging") {
      expect(result.screenStart).toEqual(dragging.screenStart);
      expect(result.startPan).toEqual(dragging.startPan);
    }
  });

  it("dragging + dragEnd -> ready", () => {
    const dragging = { type: "dragging" as const, screenStart: p, startPan: p };
    const result = hand.transition(dragging, makeDragEnd());

    expect(result.type).toBe("ready");
  });

  it("dragging + dragCancel -> ready", () => {
    const dragging = { type: "dragging" as const, screenStart: p, startPan: p };
    const result = hand.transition(dragging, makeDragCancel());

    expect(result.type).toBe("ready");
  });

  it("idle + any event -> idle", () => {
    const idle = { type: "idle" as const };
    expect(hand.transition(idle, makeDragStart()).type).toBe("idle");
    expect(hand.transition(idle, makeDragEnd()).type).toBe("idle");
  });

  it("ready + pointerMove -> ready (no state change)", () => {
    const ready = { type: "ready" as const };
    const move: ToolEvent = {
      type: "pointerMove",
      point: { x: 1, y: 1 },
      coords: makeTestCoordinates({ x: 1, y: 1 }),
    };
    const result = hand.transition(ready, move);

    expect(result.type).toBe("ready");
  });
});
