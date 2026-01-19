import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createIndicatorManager,
  type IndicatorManager,
} from "./IndicatorManager";
import type { PointId } from "@/types/ids";
import type { SegmentIndicator } from "@/types/indicator";
import { asSegmentId } from "@/types/indicator";
import { effect } from "../reactive/signal";

const asPointId = (id: number): PointId => id as unknown as PointId;

describe("IndicatorManager", () => {
  let manager: IndicatorManager;

  beforeEach(() => {
    manager = createIndicatorManager();
  });

  describe("initial state", () => {
    it("should start with no hovered point", () => {
      expect(manager.hoveredPoint).toBeNull();
    });

    it("should start with no hovered segment", () => {
      expect(manager.hoveredSegment).toBeNull();
    });
  });

  describe("setHoveredPoint", () => {
    it("should set hovered point", () => {
      manager.setHoveredPoint(asPointId(1));
      expect(manager.hoveredPoint).toBe(asPointId(1));
    });

    it("should allow null", () => {
      manager.setHoveredPoint(asPointId(1));
      manager.setHoveredPoint(null);
      expect(manager.hoveredPoint).toBeNull();
    });

    it("should clear hovered segment when setting point", () => {
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      manager.setHoveredPoint(asPointId(1));
      expect(manager.hoveredSegment).toBeNull();
    });
  });

  describe("setHoveredSegment", () => {
    it("should set hovered segment", () => {
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      expect(manager.hoveredSegment).toEqual(segmentIndicator);
    });

    it("should allow null", () => {
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      manager.setHoveredSegment(null);
      expect(manager.hoveredSegment).toBeNull();
    });

    it("should clear hovered point when setting segment", () => {
      manager.setHoveredPoint(asPointId(1));
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      expect(manager.hoveredPoint).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("should clear hovered point", () => {
      manager.setHoveredPoint(asPointId(1));
      manager.clearAll();
      expect(manager.hoveredPoint).toBeNull();
    });

    it("should clear hovered segment", () => {
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      manager.clearAll();
      expect(manager.hoveredSegment).toBeNull();
    });
  });

  describe("mutual exclusivity", () => {
    it("should ensure only point or segment is hovered at a time", () => {
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };

      manager.setHoveredPoint(asPointId(1));
      expect(manager.hoveredPoint).toBe(asPointId(1));
      expect(manager.hoveredSegment).toBeNull();

      manager.setHoveredSegment(segmentIndicator);
      expect(manager.hoveredPoint).toBeNull();
      expect(manager.hoveredSegment).toEqual(segmentIndicator);

      manager.setHoveredPoint(asPointId(2));
      expect(manager.hoveredPoint).toBe(asPointId(2));
      expect(manager.hoveredSegment).toBeNull();
    });
  });

  describe("signal reactivity", () => {
    it("should trigger effect when hoveredPoint changes", () => {
      const callback = vi.fn();
      const fx = effect(() => {
        manager.hoveredPoint;
        callback();
      });

      callback.mockClear();
      manager.setHoveredPoint(asPointId(1));
      expect(callback).toHaveBeenCalledTimes(1);

      callback.mockClear();
      manager.setHoveredPoint(asPointId(2));
      expect(callback).toHaveBeenCalledTimes(1);

      fx.dispose();
    });

    it("should trigger effect when hoveredSegment changes", () => {
      const callback = vi.fn();
      const fx = effect(() => {
        manager.hoveredSegment;
        callback();
      });

      callback.mockClear();
      const segmentIndicator: SegmentIndicator = {
        segmentId: asSegmentId("p1:p2"),
        closestPoint: { x: 50, y: 50 },
        t: 0.5,
      };
      manager.setHoveredSegment(segmentIndicator);
      expect(callback).toHaveBeenCalledTimes(1);

      fx.dispose();
    });
  });
});
