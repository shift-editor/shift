import { describe, it, expect, beforeEach, vi } from "vitest";
import { GestureDetector } from "./GestureDetector";

describe("GestureDetector", () => {
  let detector: GestureDetector;

  beforeEach(() => {
    detector = new GestureDetector();
  });

  describe("click detection", () => {
    it("emits click when pointer up without significant movement", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "click",
        point: { x: 100, y: 100 },
        shiftKey: false,
        altKey: false,
      });
    });

    it("preserves modifier keys in click event", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: true, altKey: true });
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      expect(events[0]).toMatchObject({
        type: "click",
        shiftKey: true,
        altKey: true,
      });
    });

    it("emits click even with small movement under threshold", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerMove({ x: 101, y: 101 }, { x: 101, y: 101 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 101, y: 101 }, { x: 101, y: 101 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("click");
    });
  });

  describe("double click detection", () => {
    it("emits doubleClick for two rapid clicks at same location", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "doubleClick",
        point: { x: 100, y: 100 },
      });
    });

    it("emits click instead of doubleClick if too far apart", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      detector.pointerDown({ x: 110, y: 110 }, { x: 110, y: 110 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 110, y: 110 }, { x: 110, y: 110 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("click");
    });

    it("emits click instead of doubleClick if too slow", async () => {
      vi.useFakeTimers();

      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      vi.advanceTimersByTime(400);

      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("click");

      vi.useRealTimers();
    });
  });

  describe("drag detection", () => {
    it("emits dragStart when movement exceeds threshold", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerMove({ x: 110, y: 100 }, { x: 110, y: 100 }, { shiftKey: false, altKey: false });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "dragStart",
        point: { x: 100, y: 100 },
        screenPoint: { x: 100, y: 100 },
        shiftKey: false,
        altKey: false,
      });
    });

    it("emits drag events after dragStart", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerMove({ x: 110, y: 100 }, { x: 110, y: 100 }, { shiftKey: false, altKey: false });

      const events = detector.pointerMove({ x: 120, y: 110 }, { x: 120, y: 110 }, { shiftKey: true, altKey: false });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "drag",
        point: { x: 120, y: 110 },
        screenPoint: { x: 120, y: 110 },
        origin: { x: 100, y: 100 },
        screenOrigin: { x: 100, y: 100 },
        delta: { x: 20, y: 10 },
        screenDelta: { x: 20, y: 10 },
        shiftKey: true,
        altKey: false,
      });
    });

    it("emits dragEnd on pointer up after dragging", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerMove({ x: 110, y: 100 }, { x: 110, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 120, y: 110 }, { x: 120, y: 110 });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "dragEnd",
        point: { x: 120, y: 110 },
        screenPoint: { x: 120, y: 110 },
        origin: { x: 100, y: 100 },
        screenOrigin: { x: 100, y: 100 },
      });
    });

    it("isDragging returns true during drag", () => {
      expect(detector.isDragging).toBe(false);

      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      expect(detector.isDragging).toBe(false);

      detector.pointerMove({ x: 110, y: 100 }, { x: 110, y: 100 }, { shiftKey: false, altKey: false });
      expect(detector.isDragging).toBe(true);

      detector.pointerUp({ x: 110, y: 100 }, { x: 110, y: 100 });
      expect(detector.isDragging).toBe(false);
    });
  });

  describe("reset", () => {
    it("cancels pending drag state", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerMove({ x: 110, y: 100 }, { x: 110, y: 100 }, { shiftKey: false, altKey: false });

      detector.reset();

      expect(detector.isDragging).toBe(false);
      const events = detector.pointerMove({ x: 120, y: 100 }, { x: 120, y: 100 }, { shiftKey: false, altKey: false });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pointerMove");
    });

    it("resets double-click tracking", () => {
      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      detector.reset();

      detector.pointerDown({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });

      expect(events[0].type).toBe("click");
    });
  });

  describe("edge cases", () => {
    it("returns pointerMove event when no button is down", () => {
      const events = detector.pointerMove({ x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: false, altKey: false });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "pointerMove",
        point: { x: 100, y: 100 },
      });
    });

    it("returns empty array for pointerUp without pointerDown", () => {
      const events = detector.pointerUp({ x: 100, y: 100 }, { x: 100, y: 100 });
      expect(events).toHaveLength(0);
    });
  });
});
