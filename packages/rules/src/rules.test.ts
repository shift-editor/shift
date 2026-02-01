import { describe, it, expect } from "vitest";
import { expandPattern } from "./parser";
import { buildRuleTable } from "./rules";
import { matchRule } from "./matcher";
import { applyRules, applyMovesToGlyph } from "./actions";
import type { ContourSnapshot, GlyphSnapshot, PointSnapshot } from "@shift/types";
import type { PointId, ContourId } from "@shift/types";

// Helper to create test points
function createPoint(
  id: string,
  x: number,
  y: number,
  type: "onCurve" | "offCurve",
  smooth: boolean = false,
): PointSnapshot {
  return {
    id: id as PointId,
    x,
    y,
    pointType: type,
    smooth,
  };
}

// Helper to create test contour
function createContour(
  id: string,
  points: PointSnapshot[],
  closed: boolean = false,
): ContourSnapshot {
  return {
    id: id as ContourId,
    points,
    closed,
  };
}

// Helper to create test glyph
function createGlyph(contours: ContourSnapshot[]): GlyphSnapshot {
  return {
    unicode: 65, // 'A'
    name: "test",
    xAdvance: 500,
    contours,
    activeContourId: null,
  };
}

describe("Pattern Parser", () => {
  it("expands simple pattern", () => {
    const result = expandPattern("NCH");
    expect(result).toEqual(["NCH"]);
  });

  it("expands set pattern", () => {
    const result = expandPattern("[CS]H");
    result.sort();
    expect(result).toEqual(["CH", "SH"]);
  });

  it("expands any token", () => {
    const result = expandPattern("XH");
    result.sort();
    expect(result).toEqual(["CH", "HH", "NH", "SH"]);
  });

  it("expands complex pattern", () => {
    const result = expandPattern("[X@][CS]H");
    expect(result.length).toBe(10); // (N, C, S, H, @) * (C, S) = 10
    expect(result).toContain("NCH");
    expect(result).toContain("@SH");
  });

  it("expands multiple sets", () => {
    const result = expandPattern("H[CS]H");
    expect(result.length).toBe(2);
    expect(result).toContain("HCH");
    expect(result).toContain("HSH");
  });
});

describe("Rule Table", () => {
  it("contains expected patterns", () => {
    const table = buildRuleTable();

    expect(table.has("NCH")).toBe(true);
    expect(table.has("@SH")).toBe(true);
    expect(table.has("HCH")).toBe(true);
    expect(table.has("HSH")).toBe(true);
    expect(table.has("HCC")).toBe(true);
    expect(table.has("HCS")).toBe(true);
  });

  it("maps to correct rules", () => {
    const table = buildRuleTable();

    expect(table.get("NCH")?.id).toBe("moveRightHandle");
    expect(table.get("HCN")?.id).toBe("moveLeftHandle");
    expect(table.get("HSH")?.id).toBe("moveBothHandles");
  });

  it("handles tangency patterns", () => {
    const table = buildRuleTable();

    expect(table.has("HSHNN")).toBe(true);
    expect(table.has("HSHCN")).toBe(true);
    expect(table.has("HSH@N")).toBe(true);

    const rule = table.get("HSHNN");
    expect(rule?.id).toBe("maintainTangencyRight");
  });
});

describe("Pattern Matcher", () => {
  // Create a smooth bezier contour: Corner - Handle - Smooth - Handle - Corner
  const createSmoothBezierContour = () => {
    const points = [
      createPoint("corner1", 0, 0, "onCurve", false),
      createPoint("handle1", 50, 0, "offCurve"),
      createPoint("smooth", 100, 50, "onCurve", true),
      createPoint("handle2", 150, 100, "offCurve"),
      createPoint("corner2", 200, 100, "onCurve", false),
    ];
    return createContour("contour1", points);
  };

  it("matches MoveBothHandles for smooth anchor", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["smooth" as PointId]);

    const rule = matchRule(contour, "smooth" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("moveBothHandles");
    expect(rule?.affectedPointIds.length).toBe(2);
    expect(rule?.affectedPointIds).toContain("handle1");
    expect(rule?.affectedPointIds).toContain("handle2");
  });

  it("matches MoveRightHandle for corner with right handle", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["corner1" as PointId]);

    const rule = matchRule(contour, "corner1" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("moveRightHandle");
    expect(rule?.affectedPointIds).toContain("handle1");
  });

  it("matches MaintainTangencyRight for handle on smooth point", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["handle2" as PointId]);

    const rule = matchRule(contour, "handle2" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyRight");
  });

  it("returns null for isolated corner", () => {
    const points = [
      createPoint("corner1", 0, 0, "onCurve", false),
      createPoint("corner2", 100, 0, "onCurve", false),
    ];
    const contour = createContour("contour1", points);
    const selected = new Set(["corner1" as PointId]);

    const rule = matchRule(contour, "corner1" as PointId, selected);

    expect(rule).toBeNull();
  });
});

describe("Rule Application", () => {
  const createTestGlyph = () => {
    const points = [
      createPoint("corner1", 0, 0, "onCurve", false),
      createPoint("handle1", 50, 0, "offCurve"),
      createPoint("smooth", 100, 50, "onCurve", true),
      createPoint("handle2", 150, 100, "offCurve"),
      createPoint("corner2", 200, 100, "onCurve", false),
    ];
    return createGlyph([createContour("contour1", points)]);
  };

  it("moves selected point with delta", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["corner1" as PointId]);

    const { moves } = applyRules(glyph, selected, 10, 20);

    const cornerMove = moves.find((m) => m.id === "corner1");
    expect(cornerMove).toBeDefined();
    expect(cornerMove?.x).toBe(10);
    expect(cornerMove?.y).toBe(20);
  });

  it("includes handle moves when moving smooth anchor", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["smooth" as PointId]);

    const { moves, matchedRules } = applyRules(glyph, selected, 10, 10);

    // Should have smooth + both handles
    expect(moves.length).toBe(3);
    expect(matchedRules.some((r) => r.ruleId === "moveBothHandles")).toBe(true);

    const handle1Move = moves.find((m) => m.id === "handle1");
    const handle2Move = moves.find((m) => m.id === "handle2");

    expect(handle1Move?.x).toBe(60); // 50 + 10
    expect(handle1Move?.y).toBe(10); // 0 + 10
    expect(handle2Move?.x).toBe(160); // 150 + 10
    expect(handle2Move?.y).toBe(110); // 100 + 10
  });

  it("applies moves to glyph correctly", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["smooth" as PointId]);

    const { moves } = applyRules(glyph, selected, 10, 10);
    const newGlyph = applyMovesToGlyph(glyph, moves);

    // Find the smooth point in the new glyph
    const smoothPoint = newGlyph.contours[0].points.find((p) => p.id === "smooth");
    expect(smoothPoint?.x).toBe(110); // 100 + 10
    expect(smoothPoint?.y).toBe(60); // 50 + 10

    // Original glyph should be unchanged
    const originalSmooth = glyph.contours[0].points.find((p) => p.id === "smooth");
    expect(originalSmooth?.x).toBe(100);
    expect(originalSmooth?.y).toBe(50);
  });

  it("maintains tangency when moving handle", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["handle2" as PointId]);

    const { moves, matchedRules } = applyRules(glyph, selected, 10, 0);

    expect(matchedRules.some((r) => r.ruleId === "maintainTangencyRight")).toBe(true);

    // The opposite handle should be rotated
    const handle1Move = moves.find((m) => m.id === "handle1");
    expect(handle1Move).toBeDefined();

    // Apply and check tangency is maintained
    const newGlyph = applyMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smooth")!;
    const h1 = newGlyph.contours[0].points.find((p) => p.id === "handle1")!;
    const h2 = newGlyph.contours[0].points.find((p) => p.id === "handle2")!;

    // Vectors from smooth to handles should be opposite (dot product negative)
    const vec1 = { x: h1.x - smooth.x, y: h1.y - smooth.y };
    const vec2 = { x: h2.x - smooth.x, y: h2.y - smooth.y };
    const dot = vec1.x * vec2.x + vec1.y * vec2.y;

    expect(dot).toBeLessThan(0); // Handles point in opposite directions
  });
});
