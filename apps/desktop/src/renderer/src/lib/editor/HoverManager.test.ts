import { describe, it, expect, beforeEach } from "vitest";
import { HoverManager } from "./HoverManager";
import type { PointId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";

const asPointId = (id: string): PointId => id as PointId;
const asSegmentId = (id: string): SegmentId => id as SegmentId;

const createSegmentIndicator = (segmentId: string): SegmentIndicator => ({
  segmentId: asSegmentId(segmentId),
  closestPoint: { x: 0, y: 0 },
  t: 0.5,
});

describe("HoverManager", () => {
  let hover: HoverManager;

  beforeEach(() => {
    hover = new HoverManager();
  });

  describe("initialization", () => {
    it("should initialize with no hovered point", () => {
      expect(hover.hoveredPointId).toBeNull();
    });

    it("should initialize with no hovered segment", () => {
      expect(hover.hoveredSegmentId).toBeNull();
    });
  });

  describe("point hover", () => {
    it("should set hovered point", () => {
      const pointId = asPointId("p1");
      hover.setHoveredPoint(pointId);
      expect(hover.hoveredPointId).toBe(pointId);
    });

    it("should clear hovered segment when setting hovered point", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      hover.setHoveredPoint(asPointId("p1"));
      expect(hover.hoveredSegmentId).toBeNull();
    });

    it("should allow clearing hovered point with null", () => {
      hover.setHoveredPoint(asPointId("p1"));
      hover.setHoveredPoint(null);
      expect(hover.hoveredPointId).toBeNull();
    });
  });

  describe("segment hover", () => {
    it("should set hovered segment", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      expect(hover.hoveredSegmentId).toBe(indicator);
    });

    it("should clear hovered point when setting hovered segment", () => {
      hover.setHoveredPoint(asPointId("p1"));
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      expect(hover.hoveredPointId).toBeNull();
    });

    it("should allow clearing hovered segment with null", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      hover.setHoveredSegment(null);
      expect(hover.hoveredSegmentId).toBeNull();
    });
  });

  describe("clearHover", () => {
    it("should clear hovered point", () => {
      hover.setHoveredPoint(asPointId("p1"));
      hover.clearHover();
      expect(hover.hoveredPointId).toBeNull();
    });

    it("should clear hovered segment", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      hover.clearHover();
      expect(hover.hoveredSegmentId).toBeNull();
    });

    it("should clear both point and segment", () => {
      hover.setHoveredPoint(asPointId("p1"));
      hover.clearHover();
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      hover.clearHover();
      expect(hover.hoveredPointId).toBeNull();
      expect(hover.hoveredSegmentId).toBeNull();
    });
  });

  describe("getPointVisualState", () => {
    const isPointSelected = (id: PointId) => id === asPointId("selected");

    it("should return selected when point is selected", () => {
      const state = hover.getPointVisualState(
        asPointId("selected"),
        isPointSelected,
      );
      expect(state).toBe("selected");
    });

    it("should return hovered when point is hovered", () => {
      hover.setHoveredPoint(asPointId("p1"));
      const state = hover.getPointVisualState(asPointId("p1"), () => false);
      expect(state).toBe("hovered");
    });

    it("should return hovered when point is part of hovered segment", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      const state = hover.getPointVisualState(asPointId("p1"), () => false);
      expect(state).toBe("hovered");
    });

    it("should return hovered for second point of hovered segment", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      const state = hover.getPointVisualState(asPointId("p2"), () => false);
      expect(state).toBe("hovered");
    });

    it("should return idle when point is not selected or hovered", () => {
      const state = hover.getPointVisualState(asPointId("p3"), () => false);
      expect(state).toBe("idle");
    });

    it("should prioritize selected over hovered", () => {
      hover.setHoveredPoint(asPointId("selected"));
      const state = hover.getPointVisualState(
        asPointId("selected"),
        isPointSelected,
      );
      expect(state).toBe("selected");
    });
  });

  describe("getSegmentVisualState", () => {
    const isSegmentSelected = (id: SegmentId) => id === asSegmentId("selected:segment");

    it("should return selected when segment is selected", () => {
      const state = hover.getSegmentVisualState(
        asSegmentId("selected:segment"),
        isSegmentSelected,
      );
      expect(state).toBe("selected");
    });

    it("should return hovered when segment is hovered", () => {
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      const state = hover.getSegmentVisualState(asSegmentId("p1:p2"), () => false);
      expect(state).toBe("hovered");
    });

    it("should return idle when segment is not selected or hovered", () => {
      const state = hover.getSegmentVisualState(asSegmentId("p3:p4"), () => false);
      expect(state).toBe("idle");
    });

    it("should prioritize selected over hovered", () => {
      const indicator = createSegmentIndicator("selected:segment");
      hover.setHoveredSegment(indicator);
      const state = hover.getSegmentVisualState(
        asSegmentId("selected:segment"),
        isSegmentSelected,
      );
      expect(state).toBe("selected");
    });
  });

  describe("signals", () => {
    it("should provide access to hoveredPointId signal", () => {
      const signal = hover.hoveredPointIdSignal;
      expect(signal).toBeDefined();
      expect(signal.value).toBeNull();
    });

    it("should provide access to hoveredSegmentId signal", () => {
      const signal = hover.hoveredSegmentIdSignal;
      expect(signal).toBeDefined();
      expect(signal.value).toBeNull();
    });

    it("should update signal value when setting hovered point", () => {
      const signal = hover.hoveredPointIdSignal;
      const pointId = asPointId("p1");
      hover.setHoveredPoint(pointId);
      expect(signal.value).toBe(pointId);
    });

    it("should update signal value when setting hovered segment", () => {
      const signal = hover.hoveredSegmentIdSignal;
      const indicator = createSegmentIndicator("p1:p2");
      hover.setHoveredSegment(indicator);
      expect(signal.value).toBe(indicator);
    });
  });
});
