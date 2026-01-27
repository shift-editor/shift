import { describe, it, expect } from "vitest";
import { PayloadSerializer } from "./PayloadSerializer";
import type { ClipboardContent } from "./types";

describe("PayloadSerializer", () => {
  const serializer = new PayloadSerializer();

  const sampleContent: ClipboardContent = {
    contours: [
      {
        points: [
          { x: 0, y: 0, pointType: "onCurve", smooth: false },
          { x: 100, y: 0, pointType: "onCurve", smooth: false },
          { x: 100, y: 100, pointType: "onCurve", smooth: true },
        ],
        closed: true,
      },
    ],
  };

  describe("serialize", () => {
    it("produces valid JSON", () => {
      const json = serializer.serialize(sampleContent);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("includes correct format identifier", () => {
      const json = serializer.serialize(sampleContent);
      const payload = JSON.parse(json);
      expect(payload.format).toBe("shift/glyph-data");
    });

    it("includes version 1", () => {
      const json = serializer.serialize(sampleContent);
      const payload = JSON.parse(json);
      expect(payload.version).toBe(1);
    });

    it("includes content", () => {
      const json = serializer.serialize(sampleContent);
      const payload = JSON.parse(json);
      expect(payload.content).toEqual(sampleContent);
    });

    it("includes metadata with bounds", () => {
      const json = serializer.serialize(sampleContent);
      const payload = JSON.parse(json);
      expect(payload.metadata.bounds).toBeDefined();
      expect(payload.metadata.bounds.left).toBe(0);
      expect(payload.metadata.bounds.right).toBe(100);
      expect(payload.metadata.bounds.top).toBe(0);
      expect(payload.metadata.bounds.bottom).toBe(100);
    });

    it("includes sourceGlyph when provided", () => {
      const json = serializer.serialize(sampleContent, "A");
      const payload = JSON.parse(json);
      expect(payload.metadata.sourceGlyph).toBe("A");
    });

    it("includes timestamp", () => {
      const before = Date.now();
      const json = serializer.serialize(sampleContent);
      const after = Date.now();
      const payload = JSON.parse(json);
      expect(payload.metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.metadata.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("tryDeserialize", () => {
    it("deserializes valid payload", () => {
      const json = serializer.serialize(sampleContent);
      const result = serializer.tryDeserialize(json);
      expect(result).toEqual(sampleContent);
    });

    it("returns null for unknown format", () => {
      const json = JSON.stringify({ format: "unknown", content: {} });
      const result = serializer.tryDeserialize(json);
      expect(result).toBeNull();
    });

    it("returns null for future version", () => {
      const json = JSON.stringify({
        format: "shift/glyph-data",
        version: 2,
        content: sampleContent,
      });
      const result = serializer.tryDeserialize(json);
      expect(result).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const result = serializer.tryDeserialize("not json");
      expect(result).toBeNull();
    });

    it("returns null for non-object JSON", () => {
      const result = serializer.tryDeserialize('"just a string"');
      expect(result).toBeNull();
    });

    it("roundtrips content correctly", () => {
      const original: ClipboardContent = {
        contours: [
          {
            points: [
              { x: 10, y: 20, pointType: "onCurve", smooth: true },
              { x: 30, y: 40, pointType: "offCurve", smooth: false },
              { x: 50, y: 60, pointType: "onCurve", smooth: false },
            ],
            closed: false,
          },
          {
            points: [{ x: 100, y: 100, pointType: "onCurve", smooth: false }],
            closed: true,
          },
        ],
      };

      const json = serializer.serialize(original);
      const result = serializer.tryDeserialize(json);
      expect(result).toEqual(original);
    });
  });
});
