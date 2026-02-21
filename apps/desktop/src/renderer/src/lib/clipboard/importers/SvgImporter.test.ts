import { describe, it, expect } from "vitest";
import { SvgImporter } from "./SvgImporter";

describe("SvgImporter", () => {
  const importer = new SvgImporter();
  const requireValue = <T>(value: T | null | undefined): T => {
    expect(value).toBeDefined();
    expect(value).not.toBeNull();
    if (value === null || value === undefined) {
      throw new Error("Expected value to be present");
    }
    return value;
  };
  const requireImport = (input: string) => requireValue(importer.import(input));

  describe("canImport", () => {
    it("recognizes SVG elements", () => {
      expect(importer.canImport('<svg width="100" height="100"></svg>')).toBe(true);
    });

    it("recognizes path elements", () => {
      expect(importer.canImport('<path d="M0,0 L100,100"/>')).toBe(true);
    });

    it("recognizes raw path data", () => {
      expect(importer.canImport("M0,0 L100,100 Z")).toBe(true);
    });

    it("rejects plain text", () => {
      expect(importer.canImport("hello world")).toBe(false);
    });

    it("rejects JSON", () => {
      expect(importer.canImport('{"format": "shift/glyph-data"}')).toBe(false);
    });
  });

  describe("import", () => {
    it("parses simple line path", () => {
      const result = requireImport("M0,0 L100,0 L100,100 Z");
      const contour = requireValue(result.contours[0]);

      expect(result.contours).toHaveLength(1);
      expect(contour.closed).toBe(true);
      expect(contour.points.length).toBeGreaterThanOrEqual(3);
    });

    it("parses move and line commands", () => {
      const result = requireImport("M10,20 L30,40");
      const contour = requireValue(result.contours[0]);

      expect(requireValue(contour.points[0])).toMatchObject({
        x: 10,
        y: 20,
        pointType: "onCurve",
      });
    });

    it("parses cubic bezier (C command)", () => {
      const result = requireImport("M0,0 C25,50 75,50 100,0");
      const points = requireValue(result.contours[0]).points;

      const offCurvePoints = points.filter((p) => p.pointType === "offCurve");
      expect(offCurvePoints.length).toBeGreaterThan(0);
    });

    it("parses quadratic bezier (Q command)", () => {
      const result = requireImport("M0,0 Q50,100 100,0");
      const points = requireValue(result.contours[0]).points;

      const offCurvePoints = points.filter((p) => p.pointType === "offCurve");
      expect(offCurvePoints.length).toBeGreaterThan(0);
    });

    it("parses horizontal line (H command)", () => {
      const result = requireImport("M0,0 H100");
      const points = requireValue(result.contours[0]).points;
      const secondPoint = requireValue(points[1]);

      expect(secondPoint.x).toBe(100);
      expect(secondPoint.y).toBe(0);
    });

    it("parses vertical line (V command)", () => {
      const result = requireImport("M0,0 V100");
      const points = requireValue(result.contours[0]).points;
      const secondPoint = requireValue(points[1]);

      expect(secondPoint.x).toBe(0);
      expect(secondPoint.y).toBe(100);
    });

    it("parses relative commands (lowercase)", () => {
      const result = requireImport("M10,10 l20,0 l0,20");
      const points = requireValue(result.contours[0]).points;

      expect(requireValue(points[0])).toMatchObject({ x: 10, y: 10 });
      expect(requireValue(points[1])).toMatchObject({ x: 30, y: 10 });
      expect(requireValue(points[2])).toMatchObject({ x: 30, y: 30 });
    });

    it("parses path from SVG element", () => {
      const svg = '<path d="M0,0 L100,100"/>';
      const result = requireImport(svg);

      expect(result.contours).toHaveLength(1);
    });

    it("creates multiple contours for multiple subpaths", () => {
      const result = requireImport("M0,0 L100,0 Z M50,50 L150,50 Z");
      const contour0 = requireValue(result.contours[0]);
      const contour1 = requireValue(result.contours[1]);

      expect(result.contours).toHaveLength(2);
      expect(contour0.closed).toBe(true);
      expect(contour1.closed).toBe(true);
    });

    it("returns null for invalid input", () => {
      const result = importer.import("");
      expect(result).toBeNull();
    });

    it("handles smooth curves (S command)", () => {
      const result = requireImport("M0,0 C10,20 30,20 40,0 S70,20 80,0");
      const points = requireValue(result.contours[0]).points;
      expect(points.length).toBeGreaterThan(3);
    });

    it("handles smooth quadratic (T command)", () => {
      const result = requireImport("M0,0 Q25,50 50,0 T100,0");
      const points = requireValue(result.contours[0]).points;
      expect(points.length).toBeGreaterThan(2);
    });
  });
});
