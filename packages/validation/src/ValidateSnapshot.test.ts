import { describe, it, expect } from "vitest";
import { ValidateSnapshot } from "./ValidateSnapshot";

const validPoint = () => ({
  id: "p1",
  x: 100,
  y: 200,
  pointType: "onCurve" as const,
  smooth: false,
});

const validContour = () => ({
  id: "c1",
  points: [validPoint()],
  closed: true,
});

const validGlyph = () => ({
  unicode: 65,
  name: "A",
  xAdvance: 600,
  contours: [validContour()],
  activeContourId: null,
});

describe("ValidateSnapshot", () => {
  describe("isValidPointType", () => {
    it("accepts onCurve", () => {
      expect(ValidateSnapshot.isValidPointType("onCurve")).toBe(true);
    });

    it("accepts offCurve", () => {
      expect(ValidateSnapshot.isValidPointType("offCurve")).toBe(true);
    });

    it("rejects other strings", () => {
      expect(ValidateSnapshot.isValidPointType("curve")).toBe(false);
      expect(ValidateSnapshot.isValidPointType("")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(ValidateSnapshot.isValidPointType(null)).toBe(false);
      expect(ValidateSnapshot.isValidPointType(undefined)).toBe(false);
      expect(ValidateSnapshot.isValidPointType(42)).toBe(false);
      expect(ValidateSnapshot.isValidPointType(true)).toBe(false);
    });
  });

  describe("isPointSnapshot", () => {
    it("accepts valid point", () => {
      expect(ValidateSnapshot.isPointSnapshot(validPoint())).toBe(true);
    });

    it("accepts offCurve point", () => {
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), pointType: "offCurve" })).toBe(
        true,
      );
    });

    it("rejects non-object", () => {
      expect(ValidateSnapshot.isPointSnapshot(null)).toBe(false);
      expect(ValidateSnapshot.isPointSnapshot("string")).toBe(false);
      expect(ValidateSnapshot.isPointSnapshot(42)).toBe(false);
    });

    it("rejects missing id", () => {
      const { id, ...rest } = validPoint();
      expect(ValidateSnapshot.isPointSnapshot(rest)).toBe(false);
    });

    it("rejects non-finite x", () => {
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), x: Infinity })).toBe(false);
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), x: NaN })).toBe(false);
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), x: "100" })).toBe(false);
    });

    it("rejects non-finite y", () => {
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), y: -Infinity })).toBe(false);
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), y: NaN })).toBe(false);
    });

    it("rejects invalid pointType", () => {
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), pointType: "cubic" })).toBe(false);
    });

    it("rejects non-boolean smooth", () => {
      expect(ValidateSnapshot.isPointSnapshot({ ...validPoint(), smooth: 1 })).toBe(false);
    });
  });

  describe("isContourSnapshot", () => {
    it("accepts valid contour", () => {
      expect(ValidateSnapshot.isContourSnapshot(validContour())).toBe(true);
    });

    it("accepts contour with empty points", () => {
      expect(ValidateSnapshot.isContourSnapshot({ ...validContour(), points: [] })).toBe(true);
    });

    it("rejects non-object", () => {
      expect(ValidateSnapshot.isContourSnapshot(null)).toBe(false);
      expect(ValidateSnapshot.isContourSnapshot([])).toBe(false);
    });

    it("rejects missing id", () => {
      const { id, ...rest } = validContour();
      expect(ValidateSnapshot.isContourSnapshot(rest)).toBe(false);
    });

    it("rejects non-boolean closed", () => {
      expect(ValidateSnapshot.isContourSnapshot({ ...validContour(), closed: "yes" })).toBe(false);
    });

    it("rejects non-array points", () => {
      expect(ValidateSnapshot.isContourSnapshot({ ...validContour(), points: "none" })).toBe(false);
    });

    it("rejects contour with invalid point", () => {
      expect(
        ValidateSnapshot.isContourSnapshot({
          ...validContour(),
          points: [{ x: 0, y: 0 }],
        }),
      ).toBe(false);
    });
  });

  describe("isGlyphSnapshot", () => {
    it("accepts valid glyph", () => {
      expect(ValidateSnapshot.isGlyphSnapshot(validGlyph())).toBe(true);
    });

    it("accepts glyph with string activeContourId", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), activeContourId: "c1" })).toBe(
        true,
      );
    });

    it("accepts glyph with empty contours", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), contours: [] })).toBe(true);
    });

    it("rejects non-object", () => {
      expect(ValidateSnapshot.isGlyphSnapshot(null)).toBe(false);
      expect(ValidateSnapshot.isGlyphSnapshot("glyph")).toBe(false);
    });

    it("rejects non-finite unicode", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), unicode: NaN })).toBe(false);
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), unicode: Infinity })).toBe(false);
    });

    it("rejects non-string name", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), name: 42 })).toBe(false);
    });

    it("rejects non-finite xAdvance", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), xAdvance: NaN })).toBe(false);
    });

    it("rejects non-array contours", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), contours: {} })).toBe(false);
    });

    it("rejects invalid activeContourId type", () => {
      expect(ValidateSnapshot.isGlyphSnapshot({ ...validGlyph(), activeContourId: 42 })).toBe(
        false,
      );
    });

    it("rejects glyph with invalid contour", () => {
      expect(
        ValidateSnapshot.isGlyphSnapshot({
          ...validGlyph(),
          contours: [{ id: "c1", points: "bad", closed: true }],
        }),
      ).toBe(false);
    });
  });

  describe("glyphSnapshot (detailed)", () => {
    it("returns valid for correct glyph", () => {
      const result = ValidateSnapshot.glyphSnapshot(validGlyph());
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.name).toBe("A");
      }
    });

    it("returns error for non-object", () => {
      const result = ValidateSnapshot.glyphSnapshot("not an object");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("INVALID_SNAPSHOT_STRUCTURE");
      }
    });

    it("returns error for invalid unicode", () => {
      const result = ValidateSnapshot.glyphSnapshot({ ...validGlyph(), unicode: "A" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("INVALID_SNAPSHOT_STRUCTURE");
        expect(result.errors[0].context?.field).toBe("unicode");
      }
    });

    it("returns error for invalid name", () => {
      const result = ValidateSnapshot.glyphSnapshot({ ...validGlyph(), name: null });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].context?.field).toBe("name");
      }
    });

    it("returns error for invalid xAdvance", () => {
      const result = ValidateSnapshot.glyphSnapshot({ ...validGlyph(), xAdvance: Infinity });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].context?.field).toBe("xAdvance");
      }
    });

    it("returns error for non-array contours", () => {
      const result = ValidateSnapshot.glyphSnapshot({ ...validGlyph(), contours: "bad" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].context?.field).toBe("contours");
      }
    });

    it("returns error for invalid activeContourId", () => {
      const result = ValidateSnapshot.glyphSnapshot({
        ...validGlyph(),
        activeContourId: 123,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].context?.field).toBe("activeContourId");
      }
    });

    it("returns error for invalid contour at index", () => {
      const result = ValidateSnapshot.glyphSnapshot({
        ...validGlyph(),
        contours: [{ id: "c1", points: [{ bad: true }], closed: true }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe("INVALID_CONTOUR_STRUCTURE");
        expect(result.errors[0].context?.index).toBe(0);
      }
    });
  });
});
