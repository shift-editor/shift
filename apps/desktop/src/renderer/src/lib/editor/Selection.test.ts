import { describe, it, expect, beforeEach } from "vitest";
import { Selection } from "./Selection";
import { signal } from "@/lib/signals/signal";
import type { PointId } from "@shift/types";
import type { GlyphSource } from "@/lib/model/Glyph";
import type { SegmentId } from "@shift/glyph-state";

const asPointId = (id: string): PointId => id as PointId;
const asSegmentId = (id: string): SegmentId => id as SegmentId;

describe("Selection", () => {
  let selection: Selection;

  beforeEach(() => {
    selection = new Selection(signal<GlyphSource | null>(null));
  });

  describe("initialization", () => {
    it("should initialize with empty point selection", () => {
      expect(selection.stateCell.peek().pointIds.size).toBe(0);
    });

    it("should initialize with empty segment selection", () => {
      expect(selection.stateCell.peek().segmentIds.size).toBe(0);
    });

    it("should report no selection", () => {
      expect(selection.hasSelection()).toBe(false);
    });
  });

  describe("point selection", () => {
    it("should select a single point", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(selection.stateCell.peek().pointIds.has(asPointId("p1"))).toBe(true);
      expect(selection.stateCell.peek().pointIds.size).toBe(1);
    });

    it("should select multiple points", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
        { kind: "point", id: asPointId("p3") },
      ]);
      expect(selection.stateCell.peek().pointIds.size).toBe(3);
    });

    it("should add point to selection", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.add({ kind: "point", id: asPointId("p2") });
      expect(selection.stateCell.peek().pointIds.size).toBe(2);
    });

    it("should remove point from selection", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
      ]);
      selection.remove({ kind: "point", id: asPointId("p1") });
      expect(selection.stateCell.peek().pointIds.size).toBe(1);
      expect(selection.stateCell.peek().pointIds.has(asPointId("p1"))).toBe(false);
    });

    it("should toggle point selection (add)", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.toggle({ kind: "point", id: asPointId("p2") });
      expect(selection.stateCell.peek().pointIds.size).toBe(2);
    });

    it("should toggle point selection (remove)", () => {
      selection.select([
        { kind: "point", id: asPointId("p1") },
        { kind: "point", id: asPointId("p2") },
      ]);
      selection.toggle({ kind: "point", id: asPointId("p1") });
      expect(selection.stateCell.peek().pointIds.size).toBe(1);
      expect(selection.stateCell.peek().pointIds.has(asPointId("p1"))).toBe(false);
    });

    it("should check if point is selected", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(selection.isSelected({ kind: "point", id: asPointId("p1") })).toBe(true);
      expect(selection.isSelected({ kind: "point", id: asPointId("p2") })).toBe(false);
    });

    it("should replace selection when selecting new point", () => {
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      selection.select([{ kind: "point", id: asPointId("p2") }]);
      expect(selection.stateCell.peek().pointIds.size).toBe(1);
      expect(selection.stateCell.peek().pointIds.has(asPointId("p2"))).toBe(true);
    });
  });

  describe("segment selection", () => {
    it("should select a single segment", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      expect(selection.stateCell.peek().segmentIds.has(asSegmentId("p1:p2"))).toBe(true);
      expect(selection.stateCell.peek().segmentIds.size).toBe(1);
    });

    it("should add segment to selection", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      selection.add({ kind: "segment", id: asSegmentId("p2:p3") });
      expect(selection.stateCell.peek().segmentIds.size).toBe(2);
    });

    it("should remove segment from selection", () => {
      selection.select([
        { kind: "segment", id: asSegmentId("p1:p2") },
        { kind: "segment", id: asSegmentId("p2:p3") },
      ]);
      selection.remove({ kind: "segment", id: asSegmentId("p1:p2") });
      expect(selection.stateCell.peek().segmentIds.size).toBe(1);
    });

    it("should toggle segment selection", () => {
      selection.select([{ kind: "segment", id: asSegmentId("p1:p2") }]);
      selection.toggle({ kind: "segment", id: asSegmentId("p2:p3") });
      expect(selection.stateCell.peek().segmentIds.size).toBe(2);
      selection.toggle({ kind: "segment", id: asSegmentId("p1:p2") });
      expect(selection.stateCell.peek().segmentIds.size).toBe(1);
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
      expect(selection.stateCell.peek().pointIds.size).toBe(0);
      expect(selection.stateCell.peek().segmentIds.size).toBe(0);
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

  describe("signals", () => {
    it("should update signal value when selecting points", () => {
      const sig = selection.stateCell;
      selection.select([{ kind: "point", id: asPointId("p1") }]);
      expect(sig.value.pointIds.has(asPointId("p1"))).toBe(true);
    });
  });
});
