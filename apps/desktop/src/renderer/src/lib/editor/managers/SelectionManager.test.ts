import { describe, it, expect, beforeEach } from "vitest";
import { Selection } from "@/types/selection";
import { signal } from "@/lib/reactive/signal";
import type { PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { Glyph } from "@/lib/model/Glyph";

const asPointId = (id: string): PointId => id as PointId;
const asSegmentId = (id: string): SegmentId => id as SegmentId;

describe("Selection", () => {
  let selection: Selection;

  beforeEach(() => {
    selection = new Selection(signal<Glyph | null>(null));
  });

  describe("initialization", () => {
    it("should initialize with empty point selection", () => {
      expect(selection.$pointIds.peek().size).toBe(0);
    });

    it("should initialize with empty segment selection", () => {
      expect(selection.$segmentIds.peek().size).toBe(0);
    });

    it("should initialize with committed selection mode", () => {
      expect(selection.$mode.peek()).toBe("committed");
    });

    it("should report no selection", () => {
      expect(selection.hasSelection()).toBe(false);
    });
  });

  describe("point selection", () => {
    it("should select a single point", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(selection.$pointIds.peek().has(asPointId("p1"))).toBe(true);
      expect(selection.$pointIds.peek().size).toBe(1);
    });

    it("should select multiple points", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
        { kind: "point", id: asPointId("p3") },
      ]);
      expect(selection.$pointIds.peek().size).toBe(3);
    });

    it("should add point to selection", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.add({ kind: "point", id: asPointId("p2") });
      expect(selection.$pointIds.peek().size).toBe(2);
    });

    it("should remove point from selection", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
      ]);
      selection.remove({ kind: "point", id: asPointId("p1") });
      expect(selection.$pointIds.peek().size).toBe(1);
      expect(selection.$pointIds.peek().has(asPointId("p1"))).toBe(false);
    });

    it("should toggle point selection (add)", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.toggle({ kind: "point", id: asPointId("p2") });
      expect(selection.$pointIds.peek().size).toBe(2);
    });

    it("should toggle point selection (remove)", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
      ]);
      selection.toggle({ kind: "point", id: asPointId("p1") });
      expect(selection.$pointIds.peek().size).toBe(1);
      expect(selection.$pointIds.peek().has(asPointId("p1"))).toBe(false);
    });

    it("should check if point is selected", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(selection.isSelected({ kind: "point", id: asPointId("p1") })).toBe(true);
      expect(selection.isSelected({ kind: "point", id: asPointId("p2") })).toBe(false);
    });

    it("should replace selection when selecting new point", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.select([{ kind: "point", id: asPointId("p2") }]);
      expect(selection.$pointIds.peek().size).toBe(1);
      expect(selection.$pointIds.peek().has(asPointId("p2"))).toBe(true);
    });
  });

  describe("segment selection", () => {
    it("should select a single segment", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      expect(selection.$segmentIds.peek().has(asSegmentId("p1:p2"))).toBe(true);
      expect(selection.$segmentIds.peek().size).toBe(1);
    });

    it("should add segment to selection", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      selection.add({ kind: "segment", id: asSegmentId("p2:p3") });
      expect(selection.$segmentIds.peek().size).toBe(2);
    });

    it("should remove segment from selection", () => {
      selection.select([
        { kind: "segment", id: asSegmentId("p1:p2") },
        { kind: "segment", id: asSegmentId("p2:p3") },
      ]);
      selection.remove({ kind: "segment", id: asSegmentId("p1:p2") });
      expect(selection.$segmentIds.peek().size).toBe(1);
    });

    it("should toggle segment selection", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      selection.toggle({ kind: "segment", id: asSegmentId("p2:p3") });
      expect(selection.$segmentIds.peek().size).toBe(2);
      selection.toggle({ kind: "segment", id: asSegmentId("p1:p2") });
      expect(selection.$segmentIds.peek().size).toBe(1);
    });

    it("should check if segment is selected", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      expect(selection.isSelected({ kind: "segment", id: asSegmentId("p1:p2") })).toBe(true);
      expect(selection.isSelected({ kind: "segment", id: asSegmentId("p2:p3") })).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear all selections", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.add({ kind: "segment", id: asSegmentId("p1:p2") });
      selection.clear();
      expect(selection.$pointIds.peek().size).toBe(0);
      expect(selection.$segmentIds.peek().size).toBe(0);
    });
  });

  describe("hasSelection", () => {
    it("should return true when points are selected", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(selection.hasSelection()).toBe(true);
    });

    it("should return true when segments are selected", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      expect(selection.hasSelection()).toBe(true);
    });

    it("should return false after clearing", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.clear();
      expect(selection.hasSelection()).toBe(false);
    });
  });

  describe("mode", () => {
    it("should set selection mode", () => {
      selection.setMode("preview");
      expect(selection.$mode.peek()).toBe("preview");
      selection.setMode("committed");
      expect(selection.$mode.peek()).toBe("committed");
    });
  });

  describe("signals", () => {
    it("should update signal value when selecting points", () => {
      const sig = selection.$pointIds;
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(sig.value.has(asPointId("p1"))).toBe(true);
    });
  });
});
