import { describe, it, expect, beforeEach } from "vitest";
import type { ToolEvent } from "./GestureDetector";
import type { StateDiagram } from "./StateDiagram";
import { transitionInDiagram } from "./StateDiagram";
import { createMockToolContext, makeTestCoordinates } from "@/testing";
import { Hand } from "../hand/Hand";
import { Shape } from "../shape/Shape";
import { Pen } from "../pen/Pen";
import { Select } from "../select/Select";
import { asPointId } from "@shift/types";
import type { HandleData } from "../pen/types";

const p = { x: 0, y: 0 };
const coordsP = makeTestCoordinates(p);

function makePointerMove(): ToolEvent {
  return { type: "pointerMove", point: p, coords: coordsP };
}
function makeClick(): ToolEvent {
  return { type: "click", point: p, coords: coordsP, shiftKey: false, altKey: false };
}
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
function makeDrag(): ToolEvent {
  return {
    type: "drag",
    point: p,
    coords: coordsP,
    screenPoint: p,
    origin: p,
    screenOrigin: p,
    delta: p,
    screenDelta: p,
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
function makeKeyDownEscape(): ToolEvent {
  return { type: "keyDown", key: "Escape", shiftKey: false, altKey: false, metaKey: false };
}
function makeSelectionChanged(): ToolEvent {
  return { type: "selectionChanged" };
}

function assertResultInDiagram(
  spec: StateDiagram,
  result: { type: string },
  from: string,
  eventType: string,
): void {
  expect(spec.states).toContain(result.type);
  if (result.type !== from) {
    const diagramEvent =
      eventType === "dragEnd" || eventType === "dragCancel" ? "dragEnd" : eventType;
    expect(transitionInDiagram(spec, from, diagramEvent, result.type)).toBe(true);
  }
}

describe("State diagram compliance", () => {
  describe("Hand", () => {
    let hand: Hand;
    let spec: StateDiagram;

    beforeEach(() => {
      const ctx = createMockToolContext();
      hand = new Hand(ctx);
      spec = Hand.stateSpec;
    });

    it("transition result is always in stateSpec.states and (from, event, to) in spec when state changes", () => {
      const idle = { type: "idle" as const };
      const ready = { type: "ready" as const };
      const dragging = {
        type: "dragging" as const,
        screenStart: p,
        startPan: p,
      };

      let result = hand.transition(idle, makePointerMove());
      assertResultInDiagram(spec, result, "idle", "pointerMove");

      result = hand.transition(ready, makePointerMove());
      assertResultInDiagram(spec, result, "ready", "pointerMove");

      result = hand.transition(ready, makeDragStart());
      assertResultInDiagram(spec, result, "ready", "dragStart");

      result = hand.transition(dragging, makeDrag());
      assertResultInDiagram(spec, result, "dragging", "drag");

      result = hand.transition(dragging, makeDragEnd());
      assertResultInDiagram(spec, result, "dragging", "dragEnd");

      result = hand.transition(dragging, makeDragCancel());
      assertResultInDiagram(spec, result, "dragging", "dragCancel");
    });
  });

  describe("Shape", () => {
    let shape: Shape;
    let spec: StateDiagram;

    beforeEach(() => {
      const ctx = createMockToolContext();
      shape = new Shape(ctx);
      spec = Shape.stateSpec;
    });

    it("transition result is always in stateSpec.states and (from, event, to) in spec when state changes", () => {
      const idle = { type: "idle" as const };
      const ready = { type: "ready" as const };
      const dragging = {
        type: "dragging" as const,
        startPos: p,
        currentPos: p,
      };

      let result = shape.transition(idle, makePointerMove());
      assertResultInDiagram(spec, result, "idle", "pointerMove");

      result = shape.transition(ready, makePointerMove());
      assertResultInDiagram(spec, result, "ready", "pointerMove");

      result = shape.transition(ready, makeDragStart());
      assertResultInDiagram(spec, result, "ready", "dragStart");

      result = shape.transition(dragging, makeDrag());
      assertResultInDiagram(spec, result, "dragging", "drag");

      result = shape.transition(dragging, makeDragEnd());
      assertResultInDiagram(spec, result, "dragging", "dragEnd");

      result = shape.transition(dragging, makeDragCancel());
      assertResultInDiagram(spec, result, "dragging", "dragCancel");
    });
  });

  describe("Pen", () => {
    let pen: Pen;
    let spec: StateDiagram;

    beforeEach(() => {
      const ctx = createMockToolContext();
      pen = new Pen(ctx);
      spec = Pen.stateSpec;
    });

    it("transition result is always in stateSpec.states for sampled (state, event) pairs", () => {
      const idle = { type: "idle" as const };
      const ready = { type: "ready" as const, mousePos: p };
      const anchor = {
        type: "anchored" as const,
        anchor: {
          position: p,
          pointId: asPointId("0"),
          context: {
            previousPointType: "none" as const,
            previousOnCurvePosition: null,
            isFirstPoint: true,
          },
        },
      };
      const draggingState = {
        type: "dragging" as const,
        anchor: anchor.anchor,
        handles: {} as HandleData,
        mousePos: p,
      };

      let result = pen.transition(idle, makePointerMove());
      expect(spec.states).toContain(result.type);

      result = pen.transition(ready, makePointerMove());
      expect(spec.states).toContain(result.type);

      result = pen.transition(ready, makeClick());
      expect(spec.states).toContain(result.type);

      result = pen.transition(anchor, makeDragStart());
      expect(spec.states).toContain(result.type);

      result = pen.transition(draggingState, makeDrag());
      expect(spec.states).toContain(result.type);

      result = pen.transition(draggingState, makeDragEnd());
      expect(spec.states).toContain(result.type);
    });
  });

  describe("Select", () => {
    let select: Select;
    let spec: StateDiagram;

    beforeEach(() => {
      const ctx = createMockToolContext();
      select = new Select(ctx);
      spec = Select.stateSpec;
    });

    it("transition result is always in stateSpec.states for sampled (state, event) pairs", () => {
      const idle = { type: "idle" as const };
      const ready = { type: "ready" as const };
      const selected = { type: "selected" as const };

      let result = select.transition(idle, makePointerMove());
      expect(spec.states).toContain(result.type);

      result = select.transition(ready, makePointerMove());
      expect(spec.states).toContain(result.type);

      result = select.transition(ready, makeClick());
      expect(spec.states).toContain(result.type);

      result = select.transition(ready, makeSelectionChanged());
      expect(spec.states).toContain(result.type);

      result = select.transition(selected, makeKeyDownEscape());
      expect(spec.states).toContain(result.type);

      result = select.transition(selected, makeSelectionChanged());
      expect(spec.states).toContain(result.type);
    });
  });
});
