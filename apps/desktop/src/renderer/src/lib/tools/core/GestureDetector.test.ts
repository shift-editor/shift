import { describe, it, expect, beforeEach, vi } from "vitest";
import { GestureDetector } from "./GestureDetector";
import { expectAt, makeTestCoordinates } from "@/testing";

function c(x: number, y: number) {
  return makeTestCoordinates({ x, y });
}

const NO_MODIFIERS = { shiftKey: false, altKey: false, metaKey: false };
const NORMALIZED_NO_MODIFIERS = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  accelKey: false,
};

describe("GestureDetector", () => {
  let detector: GestureDetector;

  beforeEach(() => {
    detector = new GestureDetector();
  });

  describe("click detection", () => {
    it("emits click when pointer up without significant movement", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      const events = detector.pointerUp(c(100, 100), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "click",
        coords: c(100, 100),
        ...NORMALIZED_NO_MODIFIERS,
      });
    });

    it("preserves modifier keys in click event", () => {
      const modifiers = { shiftKey: true, altKey: true, metaKey: true };

      detector.pointerDown(c(100, 100), modifiers);
      const events = detector.pointerUp(c(100, 100), modifiers);

      expect(expectAt(events, 0)).toMatchObject({
        type: "click",
        shiftKey: true,
        altKey: true,
        metaKey: true,
        ctrlKey: false,
        accelKey: true,
      });
    });

    it("emits click even with small movement under threshold", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerMove(c(101, 101), NO_MODIFIERS);
      const events = detector.pointerUp(c(101, 101), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0).type).toBe("click");
    });
  });

  describe("double click detection", () => {
    it("emits doubleClick for two rapid clicks at same location", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerUp(c(100, 100), NO_MODIFIERS);

      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      const events = detector.pointerUp(c(100, 100), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "doubleClick",
        coords: c(100, 100),
      });
    });

    it("emits click instead of doubleClick if too far apart", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerUp(c(100, 100), NO_MODIFIERS);

      detector.pointerDown(c(110, 110), NO_MODIFIERS);
      const events = detector.pointerUp(c(110, 110), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0).type).toBe("click");
    });

    it("emits click instead of doubleClick if too slow", async () => {
      vi.useFakeTimers();

      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerUp(c(100, 100), NO_MODIFIERS);

      vi.advanceTimersByTime(400);

      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      const events = detector.pointerUp(c(100, 100), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0).type).toBe("click");

      vi.useRealTimers();
    });
  });

  describe("drag detection", () => {
    it("emits dragStart when movement exceeds threshold", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      const events = detector.pointerMove(c(110, 100), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "dragStart",
        coords: c(110, 100),
        origin: c(100, 100),
        delta: { screen: { x: 10, y: 0 }, scene: { x: 10, y: 0 } },
        ...NORMALIZED_NO_MODIFIERS,
      });
    });

    it("emits drag events after dragStart", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerMove(c(110, 100), NO_MODIFIERS);

      const events = detector.pointerMove(c(120, 110), {
        shiftKey: true,
        altKey: false,
        metaKey: false,
      });

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "drag",
        coords: c(120, 110),
        origin: c(100, 100),
        delta: { screen: { x: 20, y: 10 }, scene: { x: 20, y: 10 } },
        shiftKey: true,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        accelKey: false,
      });
    });

    it("emits dragEnd on pointer up after dragging", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerMove(c(110, 100), NO_MODIFIERS);
      const events = detector.pointerUp(c(120, 110), NO_MODIFIERS);

      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "dragEnd",
        coords: c(120, 110),
        origin: c(100, 100),
        delta: { screen: { x: 20, y: 10 }, scene: { x: 20, y: 10 } },
      });
    });

    it("isDragging returns true during drag", () => {
      expect(detector.isDragging).toBe(false);

      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      expect(detector.isDragging).toBe(false);

      detector.pointerMove(c(110, 100), NO_MODIFIERS);
      expect(detector.isDragging).toBe(true);

      detector.pointerUp(c(110, 100), NO_MODIFIERS);
      expect(detector.isDragging).toBe(false);
    });
  });

  describe("reset", () => {
    it("cancels pending drag state", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerMove(c(110, 100), NO_MODIFIERS);

      detector.reset();

      expect(detector.isDragging).toBe(false);
      const events = detector.pointerMove(c(120, 100), NO_MODIFIERS);
      expect(events).toHaveLength(1);
      expect(expectAt(events, 0).type).toBe("pointerMove");
    });

    it("resets double-click tracking", () => {
      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      detector.pointerUp(c(100, 100), NO_MODIFIERS);

      detector.reset();

      detector.pointerDown(c(100, 100), NO_MODIFIERS);
      const events = detector.pointerUp(c(100, 100), NO_MODIFIERS);

      expect(expectAt(events, 0).type).toBe("click");
    });
  });

  describe("edge cases", () => {
    it("returns pointerMove event when no button is down", () => {
      const events = detector.pointerMove(c(100, 100), NO_MODIFIERS);
      expect(events).toHaveLength(1);
      expect(expectAt(events, 0)).toMatchObject({
        type: "pointerMove",
        coords: c(100, 100),
      });
    });

    it("returns empty array for pointerUp without pointerDown", () => {
      const events = detector.pointerUp(c(100, 100), NO_MODIFIERS);
      expect(events).toHaveLength(0);
    });
  });
});
