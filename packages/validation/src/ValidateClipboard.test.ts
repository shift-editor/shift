import { describe, it, expect } from "vitest";
import { ValidateClipboard } from "./ValidateClipboard";

const validPoint = () => ({
  x: 100,
  y: 200,
  pointType: "onCurve" as const,
  smooth: false,
});

const validContour = () => ({
  points: [validPoint(), { ...validPoint(), pointType: "offCurve" as const }],
  closed: true,
});

const validContent = () => ({
  contours: [validContour()],
});

const validPayload = () => ({
  format: "shift/glyph-data",
  version: 1,
  content: validContent(),
  metadata: {
    bounds: { x: 0, y: 0, width: 100, height: 200, left: 0, top: 0, right: 100, bottom: 200 },
    timestamp: Date.now(),
  },
});

describe("ValidateClipboard", () => {
  describe("isClipboardContent", () => {
    it("accepts valid content with multiple contours", () => {
      const content = { contours: [validContour(), validContour()] };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(true);
    });

    it("accepts empty contours array", () => {
      expect(ValidateClipboard.isClipboardContent({ contours: [] })).toBe(true);
    });

    it("rejects non-object", () => {
      expect(ValidateClipboard.isClipboardContent(null)).toBe(false);
      expect(ValidateClipboard.isClipboardContent("string")).toBe(false);
      expect(ValidateClipboard.isClipboardContent(42)).toBe(false);
    });

    it("rejects missing contours", () => {
      expect(ValidateClipboard.isClipboardContent({})).toBe(false);
    });

    it("rejects non-array contours", () => {
      expect(ValidateClipboard.isClipboardContent({ contours: "bad" })).toBe(false);
    });

    it("rejects contour with invalid point", () => {
      const content = {
        contours: [{ points: [{ x: 0, y: 0 }], closed: true }],
      };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(false);
    });

    it("rejects contour with missing closed field", () => {
      const content = {
        contours: [{ points: [validPoint()] }],
      };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(false);
    });

    it("rejects contour with non-array points", () => {
      const content = {
        contours: [{ points: "bad", closed: true }],
      };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(false);
    });

    it("rejects point with non-finite coordinates", () => {
      const content = {
        contours: [{ points: [{ ...validPoint(), x: Infinity }], closed: true }],
      };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(false);
    });

    it("rejects point with invalid pointType", () => {
      const content = {
        contours: [{ points: [{ ...validPoint(), pointType: "cubic" }], closed: true }],
      };
      expect(ValidateClipboard.isClipboardContent(content)).toBe(false);
    });
  });

  describe("isClipboardPayload", () => {
    it("accepts valid payload", () => {
      expect(ValidateClipboard.isClipboardPayload(validPayload())).toBe(true);
    });

    it("rejects non-object", () => {
      expect(ValidateClipboard.isClipboardPayload(null)).toBe(false);
    });

    it("rejects wrong format", () => {
      expect(ValidateClipboard.isClipboardPayload({ ...validPayload(), format: "other" })).toBe(
        false,
      );
    });

    it("rejects non-number version", () => {
      expect(ValidateClipboard.isClipboardPayload({ ...validPayload(), version: "1" })).toBe(false);
    });

    it("rejects missing metadata", () => {
      const { metadata, ...rest } = validPayload();
      expect(ValidateClipboard.isClipboardPayload(rest)).toBe(false);
    });

    it("rejects metadata without timestamp", () => {
      const payload = validPayload();
      expect(
        ValidateClipboard.isClipboardPayload({
          ...payload,
          metadata: { bounds: payload.metadata.bounds },
        }),
      ).toBe(false);
    });

    it("rejects invalid content in payload", () => {
      expect(
        ValidateClipboard.isClipboardPayload({ ...validPayload(), content: { contours: "bad" } }),
      ).toBe(false);
    });
  });
});
