import { describe, it, expect, beforeEach } from "vitest";
import type { ToolEvent } from "../core/GestureDetector";
import { Shape } from "./Shape";
import { createMockToolContext, makeTestCoordinates } from "@/testing";

const p = { x: 0, y: 0 };
const q = { x: 100, y: 50 };

function makeDragStart(point: { x: number; y: number } = p): ToolEvent {
  return {
    type: "dragStart",
    point,
    coords: makeTestCoordinates(point),
    screenPoint: point,
    shiftKey: false,
    altKey: false,
  };
}
function makeDrag(point: { x: number; y: number }): ToolEvent {
  return {
    type: "drag",
    point,
    coords: makeTestCoordinates(point),
    screenPoint: point,
    origin: p,
    screenOrigin: p,
    delta: { x: point.x - p.x, y: point.y - p.y },
    screenDelta: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
  };
}
function makeDragEnd(point: { x: number; y: number } = q): ToolEvent {
  return {
    type: "dragEnd",
    point,
    coords: makeTestCoordinates(point),
    screenPoint: point,
    origin: p,
    screenOrigin: p,
  };
}
function makeDragCancel(): ToolEvent {
  return { type: "dragCancel" };
}

describe("Shape outcome", () => {
  let shape: Shape;

  beforeEach(() => {
    const ctx = createMockToolContext();
    shape = new Shape(ctx);
  });

  it("ready + dragStart -> dragging with startPos and currentPos", () => {
    const ready = { type: "ready" as const };
    const result = shape.transition(ready, makeDragStart(q));

    expect(result.type).toBe("dragging");
    if (result.type === "dragging") {
      expect(result.startPos).toEqual(q);
      expect(result.currentPos).toEqual(q);
    }
  });

  it("dragging + drag -> dragging with updated currentPos", () => {
    const dragging = {
      type: "dragging" as const,
      startPos: p,
      currentPos: p,
    };
    const result = shape.transition(dragging, makeDrag(q));

    expect(result.type).toBe("dragging");
    if (result.type === "dragging") {
      expect(result.startPos).toEqual(p);
      expect(result.currentPos).toEqual(q);
    }
  });

  it("dragging + dragEnd -> ready", () => {
    const dragging = {
      type: "dragging" as const,
      startPos: p,
      currentPos: q,
    };
    const result = shape.transition(dragging, makeDragEnd());

    expect(result.type).toBe("ready");
  });

  it("dragging + dragCancel -> ready", () => {
    const dragging = {
      type: "dragging" as const,
      startPos: p,
      currentPos: q,
    };
    const result = shape.transition(dragging, makeDragCancel());

    expect(result.type).toBe("ready");
  });

  it("idle + any event -> idle", () => {
    const idle = { type: "idle" as const };
    expect(shape.transition(idle, makeDragStart()).type).toBe("idle");
    expect(shape.transition(idle, makeDragEnd()).type).toBe("idle");
  });

  it("ready + pointerMove -> ready (no state change)", () => {
    const ready = { type: "ready" as const };
    const move: ToolEvent = {
      type: "pointerMove",
      point: q,
      coords: makeTestCoordinates(q),
    };
    const result = shape.transition(ready, move);

    expect(result.type).toBe("ready");
  });
});
