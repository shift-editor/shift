import { describe, it, expect } from "vitest";
import { Validate } from "./Validate";
import type { PointLike } from "./types";

const onCurve = (): PointLike => ({ pointType: "onCurve" });
const offCurve = (): PointLike => ({ pointType: "offCurve" });

describe("Validate", () => {
  describe("result constructors", () => {
    it("ok() returns valid result", () => {
      const result = Validate.ok();
      expect(result.valid).toBe(true);
    });

    it("ok(value) returns valid result with value", () => {
      const result = Validate.ok(42);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value).toBe(42);
      }
    });

    it("fail() returns invalid result with error", () => {
      const error = Validate.error("EMPTY_SEQUENCE", "test error");
      const result = Validate.fail(error);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].code).toBe("EMPTY_SEQUENCE");
      }
    });
  });

  describe("point predicates", () => {
    it("isOnCurve returns true for onCurve points", () => {
      expect(Validate.isOnCurve(onCurve())).toBe(true);
      expect(Validate.isOnCurve(offCurve())).toBe(false);
    });

    it("isOffCurve returns true for offCurve points", () => {
      expect(Validate.isOffCurve(offCurve())).toBe(true);
      expect(Validate.isOffCurve(onCurve())).toBe(false);
    });
  });

  describe("sequence analysis", () => {
    it("countConsecutiveOffCurve counts correctly", () => {
      const points = [onCurve(), offCurve(), offCurve(), onCurve()];
      expect(Validate.countConsecutiveOffCurve(points, 0)).toBe(0);
      expect(Validate.countConsecutiveOffCurve(points, 1)).toBe(2);
      expect(Validate.countConsecutiveOffCurve(points, 2)).toBe(1);
      expect(Validate.countConsecutiveOffCurve(points, 3)).toBe(0);
    });

    it("findNextOnCurve finds the next onCurve point", () => {
      const points = [onCurve(), offCurve(), offCurve(), onCurve()];
      expect(Validate.findNextOnCurve(points, 0)).toBe(0);
      expect(Validate.findNextOnCurve(points, 1)).toBe(3);
      expect(Validate.findNextOnCurve(points, 3)).toBe(3);
    });

    it("findNextOnCurve returns null when no onCurve found", () => {
      const points = [offCurve(), offCurve()];
      expect(Validate.findNextOnCurve(points, 0)).toBe(null);
    });
  });

  describe("segment pattern matching", () => {
    it("matchesLinePattern validates line segments", () => {
      expect(Validate.matchesLinePattern([onCurve(), onCurve()])).toBe(true);
      expect(Validate.matchesLinePattern([onCurve()])).toBe(false);
      expect(Validate.matchesLinePattern([onCurve(), offCurve()])).toBe(false);
      expect(Validate.matchesLinePattern([offCurve(), onCurve()])).toBe(false);
    });

    it("matchesQuadPattern validates quadratic segments", () => {
      expect(Validate.matchesQuadPattern([onCurve(), offCurve(), onCurve()])).toBe(true);
      expect(Validate.matchesQuadPattern([onCurve(), onCurve(), onCurve()])).toBe(false);
      expect(Validate.matchesQuadPattern([onCurve(), offCurve()])).toBe(false);
    });

    it("matchesCubicPattern validates cubic segments", () => {
      expect(Validate.matchesCubicPattern([onCurve(), offCurve(), offCurve(), onCurve()])).toBe(
        true,
      );
      expect(Validate.matchesCubicPattern([onCurve(), offCurve(), onCurve(), onCurve()])).toBe(
        false,
      );
      expect(Validate.matchesCubicPattern([onCurve(), offCurve(), offCurve()])).toBe(false);
    });
  });

  describe("sequence validation", () => {
    it("empty sequence returns EMPTY_SEQUENCE error", () => {
      const result = Validate.sequence([]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("EMPTY_SEQUENCE");
      }
    });

    it("single onCurve is valid", () => {
      const result = Validate.sequence([onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("single offCurve returns MUST_START_WITH_ON_CURVE error", () => {
      const result = Validate.sequence([offCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("MUST_START_WITH_ON_CURVE");
      }
    });

    it("[onCurve, onCurve] (line) is valid", () => {
      const result = Validate.sequence([onCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("[onCurve, offCurve, onCurve] (quad) is valid", () => {
      const result = Validate.sequence([onCurve(), offCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("[onCurve, offCurve, offCurve, onCurve] (cubic) is valid", () => {
      const result = Validate.sequence([onCurve(), offCurve(), offCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("[offCurve, onCurve] returns MUST_START_WITH_ON_CURVE error", () => {
      const result = Validate.sequence([offCurve(), onCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("MUST_START_WITH_ON_CURVE");
      }
    });

    it("[onCurve, offCurve] returns MUST_END_WITH_ON_CURVE error", () => {
      const result = Validate.sequence([onCurve(), offCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("MUST_END_WITH_ON_CURVE");
      }
    });

    it("three consecutive offCurve returns TOO_MANY_CONSECUTIVE_OFF_CURVE error", () => {
      const result = Validate.sequence([onCurve(), offCurve(), offCurve(), offCurve(), onCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("TOO_MANY_CONSECUTIVE_OFF_CURVE");
      }
    });

    it("mixed valid sequence is valid", () => {
      const result = Validate.sequence([
        onCurve(),
        offCurve(),
        onCurve(),
        onCurve(),
        offCurve(),
        offCurve(),
        onCurve(),
      ]);
      expect(result.valid).toBe(true);
    });
  });

  describe("canFormSegments validation", () => {
    it("empty sequence returns error", () => {
      const result = Validate.canFormSegments([]);
      expect(result.valid).toBe(false);
    });

    it("single point returns INCOMPLETE_SEGMENT error", () => {
      const result = Validate.canFormSegments([onCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("INCOMPLETE_SEGMENT");
      }
    });

    it("[onCurve, onCurve] (line) can form segment", () => {
      const result = Validate.canFormSegments([onCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("[onCurve, offCurve, onCurve] (quad) can form segment", () => {
      const result = Validate.canFormSegments([onCurve(), offCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("[onCurve, offCurve, offCurve, onCurve] (cubic) can form segment", () => {
      const result = Validate.canFormSegments([onCurve(), offCurve(), offCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("mixed valid segments can form", () => {
      const result = Validate.canFormSegments([
        onCurve(),
        onCurve(),
        offCurve(),
        onCurve(),
        offCurve(),
        offCurve(),
        onCurve(),
      ]);
      expect(result.valid).toBe(true);
    });
  });

  describe("boolean predicates", () => {
    it("isValidSequence returns boolean without error details", () => {
      expect(Validate.isValidSequence([])).toBe(false);
      expect(Validate.isValidSequence([onCurve()])).toBe(true);
      expect(Validate.isValidSequence([offCurve()])).toBe(false);
      expect(Validate.isValidSequence([onCurve(), onCurve()])).toBe(true);
      expect(Validate.isValidSequence([onCurve(), offCurve()])).toBe(false);
      expect(
        Validate.isValidSequence([onCurve(), offCurve(), offCurve(), offCurve(), onCurve()]),
      ).toBe(false);
    });

    it("canFormValidSegments returns boolean without error details", () => {
      expect(Validate.canFormValidSegments([])).toBe(false);
      expect(Validate.canFormValidSegments([onCurve()])).toBe(false);
      expect(Validate.canFormValidSegments([onCurve(), onCurve()])).toBe(true);
      expect(Validate.canFormValidSegments([onCurve(), offCurve(), onCurve()])).toBe(true);
      expect(Validate.canFormValidSegments([onCurve(), offCurve(), offCurve(), onCurve()])).toBe(
        true,
      );
      expect(Validate.canFormValidSegments([offCurve(), offCurve()])).toBe(false);
    });
  });

  describe("hasAnchor validation", () => {
    it("empty sequence returns EMPTY_SEQUENCE error", () => {
      const result = Validate.hasAnchor([]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("EMPTY_SEQUENCE");
      }
    });

    it("single onCurve has anchor", () => {
      const result = Validate.hasAnchor([onCurve()]);
      expect(result.valid).toBe(true);
    });

    it("single offCurve returns ORPHAN_OFF_CURVE error", () => {
      const result = Validate.hasAnchor([offCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("ORPHAN_OFF_CURVE");
      }
    });

    it("two offCurve points without anchor returns ORPHAN_OFF_CURVE error", () => {
      const result = Validate.hasAnchor([offCurve(), offCurve()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("ORPHAN_OFF_CURVE");
      }
    });

    it("onCurve with offCurve has anchor", () => {
      const result = Validate.hasAnchor([onCurve(), offCurve()]);
      expect(result.valid).toBe(true);
    });

    it("offCurve with onCurve has anchor", () => {
      const result = Validate.hasAnchor([offCurve(), onCurve()]);
      expect(result.valid).toBe(true);
    });
  });

  describe("hasValidAnchor predicate", () => {
    it("returns false for empty sequence", () => {
      expect(Validate.hasValidAnchor([])).toBe(false);
    });

    it("returns true for single onCurve", () => {
      expect(Validate.hasValidAnchor([onCurve()])).toBe(true);
    });

    it("returns false for single offCurve", () => {
      expect(Validate.hasValidAnchor([offCurve()])).toBe(false);
    });

    it("returns false for multiple offCurve without anchor", () => {
      expect(Validate.hasValidAnchor([offCurve(), offCurve()])).toBe(false);
    });

    it("returns true for mixed sequence with anchor", () => {
      expect(Validate.hasValidAnchor([onCurve(), offCurve()])).toBe(true);
      expect(Validate.hasValidAnchor([offCurve(), onCurve()])).toBe(true);
      expect(Validate.hasValidAnchor([offCurve(), onCurve(), offCurve()])).toBe(true);
    });
  });

  describe("clipboard scenarios", () => {
    it("two consecutive offCurve points cannot form valid segments", () => {
      expect(Validate.canFormValidSegments([offCurve(), offCurve()])).toBe(false);
    });

    it("offCurve points selected without anchors cannot form valid segments", () => {
      const twoOffCurve = [offCurve(), offCurve()];
      expect(Validate.canFormValidSegments(twoOffCurve)).toBe(false);

      const result = Validate.canFormSegments(twoOffCurve);
      expect(result.valid).toBe(false);
    });

    it("valid cubic segment selection can form segments", () => {
      const cubicSegment = [onCurve(), offCurve(), offCurve(), onCurve()];
      expect(Validate.canFormValidSegments(cubicSegment)).toBe(true);
    });

    it("partial selection that expands to valid sequence passes", () => {
      const expandedSelection = [onCurve(), offCurve(), onCurve()];
      expect(Validate.canFormValidSegments(expandedSelection)).toBe(true);
    });

    it("orphan offCurve points without any anchor are invalid for copy", () => {
      expect(Validate.hasValidAnchor([offCurve(), offCurve()])).toBe(false);
    });

    it("single onCurve point is valid for copy", () => {
      expect(Validate.hasValidAnchor([onCurve()])).toBe(true);
    });

    it("onCurve with adjacent offCurve is valid for copy", () => {
      expect(Validate.hasValidAnchor([onCurve(), offCurve()])).toBe(true);
    });
  });
});
