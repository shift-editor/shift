import { describe, it, expect, beforeEach } from "vitest";
import { SelectionManager } from "./SelectionManager";
import type { PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";

const asPointId = (id: string): PointId => id as PointId;
const asSegmentId = (id: string): SegmentId => id as SegmentId;

describe("SelectionManager", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  describe("initialization", () => {
    it("should initialize with empty point selection", () => {
      expect(selection.selectedPointIds.peek().size).toBe(0);
    });

    it("should initialize with empty segment selection", () => {
      expect(selection.selectedSegmentIds.peek().size).toBe(0);
    });

    it("should initialize with committed selection mode", () => {
      expect(selection.selectionMode.peek()).toBe("committed");
    });

    it("should report no selection", () => {
      expect(selection.hasSelection()).toBe(false);
    });
  });

  describe("point selection", () => {
    it("should select a single point", () => {
      const pointId = asPointId("p1");
      selection.selectPoints(new Set([pointId]));
      expect(selection.selectedPointIds.peek().has(pointId)).toBe(true);
      expect(selection.selectedPointIds.peek().size).toBe(1);
    });

    it("should select multiple points", () => {
      const pointIds = new Set([asPointId("p1"), asPointId("p2"), asPointId("p3")]);
      selection.selectPoints(pointIds);
      expect(selection.selectedPointIds.peek().size).toBe(3);
      expect(selection.selectedPointIds.peek().has(asPointId("p1"))).toBe(true);
      expect(selection.selectedPointIds.peek().has(asPointId("p2"))).toBe(true);
      expect(selection.selectedPointIds.peek().has(asPointId("p3"))).toBe(true);
    });

    it("should add point to selection", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      selection.addPointToSelection(asPointId("p2"));
      expect(selection.selectedPointIds.peek().size).toBe(2);
      expect(selection.selectedPointIds.peek().has(asPointId("p1"))).toBe(true);
      expect(selection.selectedPointIds.peek().has(asPointId("p2"))).toBe(true);
    });

    it("should remove point from selection", () => {
      selection.selectPoints(new Set([asPointId("p1"), asPointId("p2")]));
      selection.removePointFromSelection(asPointId("p1"));
      expect(selection.selectedPointIds.peek().size).toBe(1);
      expect(selection.selectedPointIds.peek().has(asPointId("p1"))).toBe(false);
      expect(selection.selectedPointIds.peek().has(asPointId("p2"))).toBe(true);
    });

    it("should toggle point selection (add)", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      selection.togglePointSelection(asPointId("p2"));
      expect(selection.selectedPointIds.peek().size).toBe(2);
    });

    it("should toggle point selection (remove)", () => {
      selection.selectPoints(new Set([asPointId("p1"), asPointId("p2")]));
      selection.togglePointSelection(asPointId("p1"));
      expect(selection.selectedPointIds.peek().size).toBe(1);
      expect(selection.selectedPointIds.peek().has(asPointId("p1"))).toBe(false);
    });

    it("should check if point is selected", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      expect(selection.isPointSelected(asPointId("p1"))).toBe(true);
      expect(selection.isPointSelected(asPointId("p2"))).toBe(false);
    });

    it("should replace selection when selecting new point", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      selection.selectPoints(new Set([asPointId("p2")]));
      expect(selection.selectedPointIds.peek().size).toBe(1);
      expect(selection.selectedPointIds.peek().has(asPointId("p2"))).toBe(true);
    });
  });

  describe("segment selection", () => {
    it("should select a single segment", () => {
      const segmentId = asSegmentId("p1:p2");
      selection.selectSegments(new Set([segmentId]));
      expect(selection.selectedSegmentIds.peek().has(segmentId)).toBe(true);
      expect(selection.selectedSegmentIds.peek().size).toBe(1);
    });

    it("should select multiple segments", () => {
      const segmentIds = new Set([
        asSegmentId("p1:p2"),
        asSegmentId("p2:p3"),
        asSegmentId("p3:p4"),
      ]);
      selection.selectSegments(segmentIds);
      expect(selection.selectedSegmentIds.peek().size).toBe(3);
    });

    it("should add segment to selection", () => {
      selection.selectSegments(new Set([asSegmentId("p1:p2")]));
      selection.addSegmentToSelection(asSegmentId("p2:p3"));
      expect(selection.selectedSegmentIds.peek().size).toBe(2);
    });

    it("should remove segment from selection", () => {
      selection.selectSegments(
        new Set([asSegmentId("p1:p2"), asSegmentId("p2:p3")]),
      );
      selection.removeSegmentFromSelection(asSegmentId("p1:p2"));
      expect(selection.selectedSegmentIds.peek().size).toBe(1);
      expect(selection.selectedSegmentIds.peek().has(asSegmentId("p1:p2"))).toBe(
        false,
      );
    });

    it("should toggle segment selection (add)", () => {
      selection.selectSegments(new Set([asSegmentId("p1:p2")]));
      selection.toggleSegmentInSelection(asSegmentId("p2:p3"));
      expect(selection.selectedSegmentIds.peek().size).toBe(2);
    });

    it("should toggle segment selection (remove)", () => {
      selection.selectSegments(
        new Set([asSegmentId("p1:p2"), asSegmentId("p2:p3")]),
      );
      selection.toggleSegmentInSelection(asSegmentId("p1:p2"));
      expect(selection.selectedSegmentIds.peek().size).toBe(1);
    });

    it("should check if segment is selected", () => {
      selection.selectSegments(new Set([asSegmentId("p1:p2")]));
      expect(selection.isSegmentSelected(asSegmentId("p1:p2"))).toBe(true);
      expect(selection.isSegmentSelected(asSegmentId("p2:p3"))).toBe(false);
    });
  });

  describe("clear selection", () => {
    it("should clear point selection", () => {
      selection.selectPoints(new Set([asPointId("p1"), asPointId("p2")]));
      selection.clearSelection();
      expect(selection.selectedPointIds.peek().size).toBe(0);
    });

    it("should clear segment selection", () => {
      selection.selectSegments(
        new Set([asSegmentId("p1:p2"), asSegmentId("p2:p3")]),
      );
      selection.clearSelection();
      expect(selection.selectedSegmentIds.peek().size).toBe(0);
    });

    it("should clear both point and segment selection", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      selection.selectSegments(new Set([asSegmentId("p1:p2")]));
      selection.clearSelection();
      expect(selection.selectedPointIds.peek().size).toBe(0);
      expect(selection.selectedSegmentIds.peek().size).toBe(0);
    });
  });

  describe("hasSelection", () => {
    it("should return true when points are selected", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      expect(selection.hasSelection()).toBe(true);
    });

    it("should return true when segments are selected", () => {
      selection.selectSegments(new Set([asSegmentId("p1:p2")]));
      expect(selection.hasSelection()).toBe(true);
    });

    it("should return false after clearing", () => {
      selection.selectPoints(new Set([asPointId("p1")]));
      selection.clearSelection();
      expect(selection.hasSelection()).toBe(false);
    });
  });

  describe("selection mode", () => {
    it("should set selection mode to preview", () => {
      selection.setSelectionMode("preview");
      expect(selection.selectionMode.peek()).toBe("preview");
    });

    it("should set selection mode to committed", () => {
      selection.setSelectionMode("preview");
      selection.setSelectionMode("committed");
      expect(selection.selectionMode.peek()).toBe("committed");
    });
  });

  describe("signals", () => {
    it("should provide access to selectedPointIds signal", () => {
      const signal = selection.selectedPointIds;
      expect(signal).toBeDefined();
      expect(signal.value.size).toBe(0);
    });

    it("should provide access to selectedSegmentIds signal", () => {
      const signal = selection.selectedSegmentIds;
      expect(signal).toBeDefined();
      expect(signal.value.size).toBe(0);
    });

    it("should provide access to selectionMode signal", () => {
      const signal = selection.selectionMode;
      expect(signal).toBeDefined();
      expect(signal.value).toBe("committed");
    });

    it("should update signal value when selecting points", () => {
      const signal = selection.selectedPointIds;
      selection.selectPoints(new Set([asPointId("p1")]));
      expect(signal.value.has(asPointId("p1"))).toBe(true);
    });
  });
});
