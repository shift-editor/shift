import { describe, it, expect } from "vitest";
import { expandPattern } from "./parser";
import { buildRuleTable, buildRuleTableFromSpecs } from "./rules";
import { diagnoseSelectionPatterns, pickRule } from "./matcher";
import { constrainDrag } from "./actions";
import type { ContourSnapshot, GlyphSnapshot, PointSnapshot } from "@shift/types";
import type { PointId, ContourId } from "@shift/types";
import type { PointMove } from "./types";

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
    anchors: [],
    compositeContours: [],
    activeContourId: null,
  };
}

function applyPointMovesToGlyph(glyph: GlyphSnapshot, moves: PointMove[]): GlyphSnapshot {
  const moveMap = new Map<PointId, PointMove>();
  for (const move of moves) {
    moveMap.set(move.id, move);
  }

  return {
    ...glyph,
    contours: glyph.contours.map((contour) => ({
      ...contour,
      points: contour.points.map((point) => {
        const move = moveMap.get(point.id);
        if (!move) return point;
        return { ...point, x: move.x, y: move.y };
      }),
    })),
  };
}

function runConstrainDrag(
  glyph: GlyphSnapshot,
  selectedIds: ReadonlySet<PointId>,
  dx: number,
  dy: number,
) {
  return constrainDrag({
    glyph,
    selectedIds,
    mousePosition: { x: dx, y: dy },
  });
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

    expect(table.get("NCH")?.rule.id).toBe("moveRightHandle");
    expect(table.get("HCN")?.rule.id).toBe("moveLeftHandle");
    expect(table.get("HSH")?.rule.id).toBe("moveBothHandles");
    expect(table.get("CHHSC")?.rule.id).toBe("maintainCollinearity");
    expect(table.get("CSHHC")?.rule.id).toBe("maintainCollinearity");
  });

  it("handles tangency patterns", () => {
    const table = buildRuleTable();

    expect(table.has("HSHNN")).toBe(true);
    expect(table.has("HSHCN")).toBe(true);
    expect(table.has("HSH@N")).toBe(true);
    expect(table.get("HSC")?.rule.id).toBe("maintainTangencyBoth");
    expect(table.get("CSC")?.rule.id).toBe("maintainTangencyBoth");
    expect(table.get("CSH")?.rule.id).toBe("maintainTangencyBoth");

    const rule = table.get("HSHNN");
    expect(rule?.rule.id).toBe("maintainTangencyRight");
  });

  it("throws on duplicate concrete patterns without explicit override", () => {
    expect(() =>
      buildRuleTableFromSpecs([
        {
          id: "moveRightHandle",
          description: "base",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "rightHandle", offset: 1 }] }],
        },
        {
          id: "moveLeftHandle",
          description: "duplicate",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "leftHandle", offset: -1 }] }],
        },
      ]),
    ).toThrow(/Duplicate concrete pattern "NCH"/);
  });

  it("allows explicit override when precedence is higher", () => {
    const table = buildRuleTableFromSpecs([
      {
        id: "moveRightHandle",
        description: "base",
        entries: [{ patternTemplate: "NCH", affected: [{ role: "rightHandle", offset: 1 }] }],
      },
      {
        id: "moveLeftHandle",
        description: "override",
        entries: [{ patternTemplate: "NCH", affected: [{ role: "leftHandle", offset: -1 }] }],
        allowPatternOverride: true,
        priority: 1,
      },
    ]);

    expect(table.get("NCH")?.rule.id).toBe("moveLeftHandle");
  });

  it("rejects explicit override when precedence is tied", () => {
    expect(() =>
      buildRuleTableFromSpecs([
        {
          id: "moveRightHandle",
          description: "base",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "rightHandle", offset: 1 }] }],
        },
        {
          id: "moveLeftHandle",
          description: "override",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "leftHandle", offset: -1 }] }],
          allowPatternOverride: true,
          priority: 0,
        },
      ]),
    ).toThrow(/Ambiguous override/);
  });

  it("rejects explicit override when precedence is lower", () => {
    expect(() =>
      buildRuleTableFromSpecs([
        {
          id: "moveRightHandle",
          description: "base",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "rightHandle", offset: 1 }] }],
          priority: 1,
        },
        {
          id: "moveLeftHandle",
          description: "override",
          entries: [{ patternTemplate: "NCH", affected: [{ role: "leftHandle", offset: -1 }] }],
          allowPatternOverride: true,
          priority: 0,
        },
      ]),
    ).toThrow(/lower precedence/);
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

  const createCollinearityContour = (closed: boolean = false) => {
    const points = closed
      ? [
          createPoint("handleClosed", 0, 20, "offCurve"),
          createPoint("smoothClosed", 10, 20, "onCurve", true),
          createPoint("cornerClosed", 20, 0, "onCurve", false),
          createPoint("cornerWrapClosed", -20, 0, "onCurve", false),
          createPoint("handleWrapClosed", -10, 10, "offCurve"),
        ]
      : [
          createPoint("cornerCol", -20, 0, "onCurve", false),
          createPoint("smoothCol", 0, 0, "onCurve", true),
          createPoint("handleCol", 10, 10, "offCurve"),
          createPoint("pairedHandleCol", 20, 10, "offCurve"),
          createPoint("cornerColEnd", 30, 0, "onCurve", false),
        ];

    return createContour("collinearity-contour", points, closed);
  };

  it("matches MoveBothHandles for smooth anchor", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["smooth" as PointId]);

    const rule = pickRule(contour, "smooth" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("moveBothHandles");
    expect(rule?.affected).toEqual({
      leftHandle: "handle1",
      rightHandle: "handle2",
    });
  });

  it("matches MoveRightHandle for corner with right handle", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["corner1" as PointId]);

    const rule = pickRule(contour, "corner1" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("moveRightHandle");
    expect(rule?.affected).toEqual({
      rightHandle: "handle1",
    });
  });

  it("matches MaintainTangencyRight for handle on smooth point", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["handle2" as PointId]);

    const rule = pickRule(contour, "handle2" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyRight");
  });

  it("matches MaintainTangencyLeft without collinearity fallthrough", () => {
    const contour = createSmoothBezierContour();
    const selected = new Set(["handle1" as PointId]);

    const rule = pickRule(contour, "handle1" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyLeft");
    expect(rule?.affected).toEqual({
      smooth: "smooth",
      oppositeHandle: "handle2",
    });
  });

  it("matches MaintainTangencyBoth for HSC smooth-center pattern", () => {
    const contour = createContour("tangency-both-hsc", [
      createPoint("targetHandle", -20, 0, "offCurve"),
      createPoint("smoothCenter", 0, 0, "onCurve", true),
      createPoint("referenceCorner", 20, 0, "onCurve", false),
    ]);
    const selected = new Set(["smoothCenter" as PointId]);

    const rule = pickRule(contour, "smoothCenter" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyBoth");
    expect(rule?.pattern).toBe("HSC");
    expect(rule?.affected).toEqual({
      target: "targetHandle",
      reference: "referenceCorner",
    });
  });

  it("matches MaintainTangencyBoth for HSCSH corner-center pattern", () => {
    const contour = createContour("tangency-both-hscsh", [
      createPoint("leftHandle", -20, 10, "offCurve"),
      createPoint("leftSmooth", -10, 10, "onCurve", true),
      createPoint("centerCorner", 0, 0, "onCurve", false),
      createPoint("rightSmooth", 10, 10, "onCurve", true),
      createPoint("rightHandle", 20, 10, "offCurve"),
    ]);
    const selected = new Set(["centerCorner" as PointId]);

    const rule = pickRule(contour, "centerCorner" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyBoth");
    expect(rule?.pattern).toBe("HSCSH");
    expect(rule?.affected).toEqual({
      leftHandle: "leftHandle",
      leftSmooth: "leftSmooth",
      rightSmooth: "rightSmooth",
      rightHandle: "rightHandle",
    });
  });

  it("matches MaintainTangencyBoth for HHSSH smooth-center pattern", () => {
    const contour = createContour("tangency-both-hhssh", [
      createPoint("unusedHandle", -30, 0, "offCurve"),
      createPoint("associatedHandle", -10, 0, "offCurve"),
      createPoint("selectedSmooth", 0, 0, "onCurve", true),
      createPoint("otherSmooth", 20, 0, "onCurve", true),
      createPoint("otherHandle", 30, 0, "offCurve"),
    ]);
    const selected = new Set(["selectedSmooth" as PointId]);

    const rule = pickRule(contour, "selectedSmooth" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainTangencyBoth");
    expect(rule?.pattern).toBe("HHSSH");
    expect(rule?.affected).toEqual({
      associatedHandle: "associatedHandle",
      otherSmooth: "otherSmooth",
      otherHandle: "otherHandle",
    });
  });

  it("matches MaintainCollinearity for CSHHC handle configuration", () => {
    const contour = createCollinearityContour();
    const selected = new Set(["handleCol" as PointId]);

    const rule = pickRule(contour, "handleCol" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainCollinearity");
    expect(rule?.pattern).toBe("CSHHC");
    expect(rule?.affected).toEqual({
      smooth: "smoothCol",
      end: "cornerCol",
    });
  });

  it("matches MaintainCollinearity when adjacent handle is also selected", () => {
    const contour = createCollinearityContour();
    const selected = new Set(["handleCol" as PointId, "pairedHandleCol" as PointId]);

    const rule = pickRule(contour, "handleCol" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainCollinearity");
    expect(rule?.pattern).toBe("CSH@C");
    expect(rule?.affected).toEqual({
      smooth: "smoothCol",
      end: "cornerCol",
    });
  });

  it("matches MaintainCollinearity for CHHSC handle configuration", () => {
    const contour = createContour("collinearity-handle-left", [
      createPoint("cornerStart", -20, 0, "onCurve", false),
      createPoint("handlePrev", -10, 10, "offCurve"),
      createPoint("handleSel", 0, 20, "offCurve"),
      createPoint("smoothMid", 10, 20, "onCurve", true),
      createPoint("cornerEnd", 20, 0, "onCurve", false),
    ]);
    const selected = new Set(["handleSel" as PointId]);

    const rule = pickRule(contour, "handleSel" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainCollinearity");
    expect(rule?.pattern).toBe("CHHSC");
    expect(rule?.affected).toEqual({
      smooth: "smoothMid",
      end: "cornerEnd",
    });
  });

  it("matches MaintainCollinearity across seam in closed contours", () => {
    const contour = createCollinearityContour(true);
    const selected = new Set(["handleClosed" as PointId]);

    const rule = pickRule(contour, "handleClosed" as PointId, selected);

    expect(rule).not.toBeNull();
    expect(rule?.ruleId).toBe("maintainCollinearity");
    expect(rule?.pattern).toBe("CHHSC");
    expect(rule?.affected).toEqual({
      smooth: "smoothClosed",
      end: "cornerClosed",
    });
  });

  it("returns null for isolated corner", () => {
    const points = [
      createPoint("corner1", 0, 0, "onCurve", false),
      createPoint("corner2", 100, 0, "onCurve", false),
    ];
    const contour = createContour("contour1", points);
    const selected = new Set(["corner1" as PointId]);

    const rule = pickRule(contour, "corner1" as PointId, selected);

    expect(rule).toBeNull();
  });

  it("diagnoses tried patterns and matched rule for selected smooth point", () => {
    const contour = createSmoothBezierContour();
    const glyph = createGlyph([contour]);
    const selected = new Set(["smooth" as PointId]);

    const diagnostics = diagnoseSelectionPatterns(glyph, selected);

    expect(diagnostics.selectedPointIds).toEqual(["smooth"]);
    expect(diagnostics.points).toHaveLength(1);

    const point = diagnostics.points[0];
    expect(point.contourId).toBe("contour1");
    expect(point.pointIndex).toBe(2);
    expect(point.probes).toEqual([
      { windowSize: 5, pattern: "CHSHC", matched: false },
      { windowSize: 3, pattern: "HSH", matched: true },
    ]);
    expect(point.matchedRule?.ruleId).toBe("moveBothHandles");
    expect(point.matchedRule?.affected).toEqual({
      leftHandle: "handle1",
      rightHandle: "handle2",
    });
  });

  it("diagnoses unmatched points with all attempted windows in order", () => {
    const contour = createContour("contour1", [
      createPoint("corner1", 0, 0, "onCurve", false),
      createPoint("corner2", 100, 0, "onCurve", false),
    ]);
    const glyph = createGlyph([contour]);
    const selected = new Set(["corner1" as PointId]);

    const diagnostics = diagnoseSelectionPatterns(glyph, selected);
    const point = diagnostics.points[0];

    expect(point.probes).toEqual([
      { windowSize: 5, pattern: "NNCCN", matched: false },
      { windowSize: 3, pattern: "NCC", matched: false },
    ]);
    expect(point.matchedRule).toBeNull();
  });

  it("reports missing selected points without probes", () => {
    const glyph = createGlyph([]);
    const selected = new Set(["missing" as PointId]);

    const diagnostics = diagnoseSelectionPatterns(glyph, selected);

    expect(diagnostics.points).toEqual([
      {
        pointId: "missing",
        contourId: null,
        pointIndex: null,
        probes: [],
        matchedRule: null,
      },
    ]);
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

  const createCollinearityGlyph = () => {
    const points = [
      createPoint("cornerCol", -20, 0, "onCurve", false),
      createPoint("smoothCol", 0, 0, "onCurve", true),
      createPoint("handleCol", 10, 10, "offCurve"),
      createPoint("pairedHandleCol", 20, 10, "offCurve"),
      createPoint("cornerColEnd", 30, 0, "onCurve", false),
    ];
    return createGlyph([createContour("collinearity-contour", points)]);
  };

  const createTangencyConflictGlyph = () => {
    const points = [
      createPoint("cornerStart", -20, 0, "onCurve", false),
      createPoint("handlePrev", -10, 10, "offCurve"),
      createPoint("handleSel", 0, 20, "offCurve"),
      createPoint("smoothMid", 10, 20, "onCurve", true),
      createPoint("cornerEnd", 20, 0, "onCurve", false),
    ];
    return createGlyph([createContour("tangency-conflict-contour", points)]);
  };

  it("moves selected point with delta", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["corner1" as PointId]);

    const { pointUpdates: moves } = runConstrainDrag(glyph, selected, 10, 20);

    const cornerMove = moves.find((m) => m.id === "corner1");
    expect(cornerMove).toBeDefined();
    expect(cornerMove?.x).toBe(10);
    expect(cornerMove?.y).toBe(20);
  });

  it("skips rule matching for isolated corner-only translations", () => {
    const glyph = createGlyph([
      createContour("corners-only", [
        createPoint("corner1", 0, 0, "onCurve", false),
        createPoint("corner2", 100, 0, "onCurve", false),
        createPoint("corner3", 200, 50, "onCurve", false),
      ]),
    ]);
    const selected = new Set(["corner1" as PointId, "corner2" as PointId]);

    const { pointUpdates: moves, matched } = runConstrainDrag(glyph, selected, 15, -5);

    expect(matched).toEqual([]);
    expect(moves).toEqual([
      { id: "corner1", x: 15, y: -5 },
      { id: "corner2", x: 115, y: -5 },
    ]);
  });

  it("includes handle moves when moving smooth anchor", () => {
    const glyph = createTestGlyph();
    const selected = new Set(["smooth" as PointId]);

    const { pointUpdates: moves, matched: matchedRules } = runConstrainDrag(
      glyph,
      selected,
      10,
      10,
    );

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

    const { pointUpdates: moves } = runConstrainDrag(glyph, selected, 10, 10);
    const newGlyph = applyPointMovesToGlyph(glyph, moves);

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

    const { pointUpdates: moves, matched: matchedRules } = runConstrainDrag(glyph, selected, 10, 0);

    expect(matchedRules.some((r) => r.ruleId === "maintainTangencyRight")).toBe(true);

    // The opposite handle should be rotated
    const handle1Move = moves.find((m) => m.id === "handle1");
    expect(handle1Move).toBeDefined();

    // Apply and check tangency is maintained
    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smooth")!;
    const h1 = newGlyph.contours[0].points.find((p) => p.id === "handle1")!;
    const h2 = newGlyph.contours[0].points.find((p) => p.id === "handle2")!;

    // Vectors from smooth to handles should be opposite (dot product negative)
    const vec1 = { x: h1.x - smooth.x, y: h1.y - smooth.y };
    const vec2 = { x: h2.x - smooth.x, y: h2.y - smooth.y };
    const dot = vec1.x * vec2.x + vec1.y * vec2.y;

    expect(dot).toBeLessThan(0); // Handles point in opposite directions
  });

  it("maintains tangency-both target/reference branch when dragging smooth", () => {
    const glyph = createGlyph([
      createContour("tangency-both-hsc", [
        createPoint("targetHandle", -10, 0, "offCurve"),
        createPoint("smoothCenter", 0, 0, "onCurve", true),
        createPoint("referenceCorner", 10, 0, "onCurve", false),
      ]),
    ]);
    const selected = new Set(["smoothCenter" as PointId]);

    const { pointUpdates: moves, matched } = runConstrainDrag(glyph, selected, 0, 10);
    expect(matched.some((r) => r.ruleId === "maintainTangencyBoth")).toBe(true);

    const referenceMove = moves.find((m) => m.id === "referenceCorner");
    expect(referenceMove).toBeUndefined();

    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smoothCenter")!;
    const target = newGlyph.contours[0].points.find((p) => p.id === "targetHandle")!;
    const reference = newGlyph.contours[0].points.find((p) => p.id === "referenceCorner")!;

    const smoothToTarget = { x: target.x - smooth.x, y: target.y - smooth.y };
    const smoothToReference = { x: reference.x - smooth.x, y: reference.y - smooth.y };
    const targetLen = Math.hypot(smoothToTarget.x, smoothToTarget.y);
    const originalLen = Math.hypot(-10, 0);
    const cross = smoothToTarget.x * smoothToReference.y - smoothToTarget.y * smoothToReference.x;
    const dot = smoothToTarget.x * smoothToReference.x + smoothToTarget.y * smoothToReference.y;

    expect(Math.abs(targetLen - originalLen)).toBeLessThan(1e-8);
    expect(Math.abs(cross)).toBeLessThan(1e-8);
    expect(dot).toBeLessThanOrEqual(0);
  });

  it("maintains tangency-both dual-handle branch for HSCSH", () => {
    const glyph = createGlyph([
      createContour("tangency-both-hscsh", [
        createPoint("leftHandle", -15, 12, "offCurve"),
        createPoint("leftSmooth", -10, 10, "onCurve", true),
        createPoint("centerCorner", 0, 0, "onCurve", false),
        createPoint("rightSmooth", 10, 10, "onCurve", true),
        createPoint("rightHandle", 15, 12, "offCurve"),
      ]),
    ]);
    const selected = new Set(["centerCorner" as PointId]);

    const { pointUpdates: moves, matched } = runConstrainDrag(glyph, selected, 0, 5);
    expect(matched.some((r) => r.ruleId === "maintainTangencyBoth")).toBe(true);

    const leftMove = moves.find((m) => m.id === "leftHandle");
    const rightMove = moves.find((m) => m.id === "rightHandle");
    expect(leftMove).toBeDefined();
    expect(rightMove).toBeDefined();

    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const selectedPoint = newGlyph.contours[0].points.find((p) => p.id === "centerCorner")!;
    const leftSmooth = newGlyph.contours[0].points.find((p) => p.id === "leftSmooth")!;
    const rightSmooth = newGlyph.contours[0].points.find((p) => p.id === "rightSmooth")!;
    const leftHandle = newGlyph.contours[0].points.find((p) => p.id === "leftHandle")!;
    const rightHandle = newGlyph.contours[0].points.find((p) => p.id === "rightHandle")!;

    const leftToSelected = { x: selectedPoint.x - leftSmooth.x, y: selectedPoint.y - leftSmooth.y };
    const leftToHandle = { x: leftHandle.x - leftSmooth.x, y: leftHandle.y - leftSmooth.y };
    const leftCross = leftToSelected.x * leftToHandle.y - leftToSelected.y * leftToHandle.x;
    const leftDot = leftToSelected.x * leftToHandle.x + leftToSelected.y * leftToHandle.y;

    const rightToSelected = {
      x: selectedPoint.x - rightSmooth.x,
      y: selectedPoint.y - rightSmooth.y,
    };
    const rightToHandle = { x: rightHandle.x - rightSmooth.x, y: rightHandle.y - rightSmooth.y };
    const rightCross = rightToSelected.x * rightToHandle.y - rightToSelected.y * rightToHandle.x;
    const rightDot = rightToSelected.x * rightToHandle.x + rightToSelected.y * rightToHandle.y;

    expect(Math.abs(leftCross)).toBeLessThan(1e-8);
    expect(leftDot).toBeLessThanOrEqual(0);
    expect(Math.abs(rightCross)).toBeLessThan(1e-8);
    expect(rightDot).toBeLessThanOrEqual(0);
  });

  it("maintains tangency-both associated/other branch for HHSSH", () => {
    const glyph = createGlyph([
      createContour("tangency-both-hhssh", [
        createPoint("unusedHandle", -25, 0, "offCurve"),
        createPoint("associatedHandle", -10, 0, "offCurve"),
        createPoint("selectedSmooth", 0, 0, "onCurve", true),
        createPoint("otherSmooth", 20, 0, "onCurve", true),
        createPoint("otherHandle", 30, 0, "offCurve"),
      ]),
    ]);
    const selected = new Set(["selectedSmooth" as PointId]);

    const { pointUpdates: moves, matched } = runConstrainDrag(glyph, selected, 0, 10);
    expect(matched.some((r) => r.ruleId === "maintainTangencyBoth")).toBe(true);

    const associatedMove = moves.find((m) => m.id === "associatedHandle");
    const otherMove = moves.find((m) => m.id === "otherHandle");
    expect(associatedMove).toBeDefined();
    expect(otherMove).toBeDefined();

    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const selectedSmooth = newGlyph.contours[0].points.find((p) => p.id === "selectedSmooth")!;
    const associatedHandle = newGlyph.contours[0].points.find((p) => p.id === "associatedHandle")!;
    const otherSmooth = newGlyph.contours[0].points.find((p) => p.id === "otherSmooth")!;
    const otherHandle = newGlyph.contours[0].points.find((p) => p.id === "otherHandle")!;

    const assocLen = Math.hypot(
      associatedHandle.x - selectedSmooth.x,
      associatedHandle.y - selectedSmooth.y,
    );
    const otherLen = Math.hypot(otherHandle.x - otherSmooth.x, otherHandle.y - otherSmooth.y);
    expect(Math.abs(assocLen - 10)).toBeLessThan(1e-8);
    expect(Math.abs(otherLen - 10)).toBeLessThan(1e-8);

    const selectedToOtherSmooth = {
      x: otherSmooth.x - selectedSmooth.x,
      y: otherSmooth.y - selectedSmooth.y,
    };
    const selectedToAssoc = {
      x: associatedHandle.x - selectedSmooth.x,
      y: associatedHandle.y - selectedSmooth.y,
    };
    const otherSmoothToOtherHandle = {
      x: otherHandle.x - otherSmooth.x,
      y: otherHandle.y - otherSmooth.y,
    };

    const assocCross =
      selectedToOtherSmooth.x * selectedToAssoc.y - selectedToOtherSmooth.y * selectedToAssoc.x;
    const assocDot =
      selectedToOtherSmooth.x * selectedToAssoc.x + selectedToOtherSmooth.y * selectedToAssoc.y;
    const otherCross =
      selectedToOtherSmooth.x * otherSmoothToOtherHandle.y -
      selectedToOtherSmooth.y * otherSmoothToOtherHandle.x;
    const otherDot =
      selectedToOtherSmooth.x * otherSmoothToOtherHandle.x +
      selectedToOtherSmooth.y * otherSmoothToOtherHandle.y;

    expect(Math.abs(assocCross)).toBeLessThan(1e-8);
    expect(assocDot).toBeLessThanOrEqual(0);
    expect(Math.abs(otherCross)).toBeLessThan(1e-8);
    expect(otherDot).toBeGreaterThanOrEqual(0);
  });

  it("maintains collinearity when moving handle point", () => {
    const glyph = createCollinearityGlyph();
    const selected = new Set(["handleCol" as PointId]);

    const { pointUpdates: moves, matched: matchedRules } = runConstrainDrag(glyph, selected, 0, 10);

    expect(matchedRules.some((r) => r.ruleId === "maintainCollinearity")).toBe(true);

    const handleMove = moves.find((m) => m.id === "handleCol");
    expect(handleMove).toBeDefined();

    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smoothCol")!;
    const corner = newGlyph.contours[0].points.find((p) => p.id === "cornerCol")!;
    const handle = newGlyph.contours[0].points.find((p) => p.id === "handleCol")!;

    const awayFromCorner = { x: smooth.x - corner.x, y: smooth.y - corner.y };
    const smoothToHandle = { x: handle.x - smooth.x, y: handle.y - smooth.y };
    const cross = awayFromCorner.x * smoothToHandle.y - awayFromCorner.y * smoothToHandle.x;
    const dot = awayFromCorner.x * smoothToHandle.x + awayFromCorner.y * smoothToHandle.y;

    expect(Math.abs(cross)).toBeLessThan(1e-8);
    expect(dot).toBeGreaterThanOrEqual(0);
  });

  it("reflects handle at smooth when projection goes past smooth", () => {
    const glyph = createCollinearityGlyph();
    const selected = new Set(["handleCol" as PointId]);

    const { pointUpdates: moves } = runConstrainDrag(glyph, selected, 10, 5);
    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smoothCol")!;
    const corner = newGlyph.contours[0].points.find((p) => p.id === "cornerCol")!;
    const handle = newGlyph.contours[0].points.find((p) => p.id === "handleCol")!;

    const awayFromCorner = { x: smooth.x - corner.x, y: smooth.y - corner.y };
    const smoothHandle = { x: handle.x - smooth.x, y: handle.y - smooth.y };
    const cross = awayFromCorner.x * smoothHandle.y - awayFromCorner.y * smoothHandle.x;
    const dot = awayFromCorner.x * smoothHandle.x + awayFromCorner.y * smoothHandle.y;

    expect(Math.abs(cross)).toBeLessThan(1e-8);
    expect(dot).toBeGreaterThanOrEqual(0);
  });

  it("clamps selected handle so it reflects at smooth instead of crossing", () => {
    const glyph = createCollinearityGlyph();
    const selected = new Set(["handleCol" as PointId]);

    const { pointUpdates: moves, matched: matchedRules } = runConstrainDrag(
      glyph,
      selected,
      -40,
      -5,
    );
    expect(matchedRules.some((r) => r.ruleId === "maintainCollinearity")).toBe(true);

    const handleMove = moves.find((m) => m.id === "handleCol");
    expect(handleMove).toBeDefined();

    const newGlyph = applyPointMovesToGlyph(glyph, moves);
    const smooth = newGlyph.contours[0].points.find((p) => p.id === "smoothCol")!;
    const corner = newGlyph.contours[0].points.find((p) => p.id === "cornerCol")!;
    const handle = newGlyph.contours[0].points.find((p) => p.id === "handleCol")!;

    const awayFromCorner = { x: smooth.x - corner.x, y: smooth.y - corner.y };
    const smoothHandle = { x: handle.x - smooth.x, y: handle.y - smooth.y };
    const cross = awayFromCorner.x * smoothHandle.y - awayFromCorner.y * smoothHandle.x;
    const dot = awayFromCorner.x * smoothHandle.x + awayFromCorner.y * smoothHandle.y;

    expect(Math.abs(cross)).toBeLessThan(1e-8);
    expect(dot).toBeGreaterThanOrEqual(0);
  });

  it("does not move corner in CHHSC handle drag collinearity case", () => {
    const glyph = createTangencyConflictGlyph();
    const selected = new Set(["handleSel" as PointId]);

    const { pointUpdates: moves, matched: matchedRules } = runConstrainDrag(glyph, selected, 5, 0);
    expect(matchedRules.some((r) => r.ruleId === "maintainCollinearity")).toBe(true);

    const cornerMove = moves.find((m) => m.id === "cornerEnd");
    expect(cornerMove).toBeUndefined();
  });

  it("skips collinearity projection when smooth-corner axis is degenerate", () => {
    const glyph = createGlyph([
      createContour("degenerate-collinearity", [
        createPoint("cornerStart", -20, 0, "onCurve", false),
        createPoint("handlePrev", -10, 10, "offCurve"),
        createPoint("handleSel", 0, 20, "offCurve"),
        createPoint("smoothMid", 10, 20, "onCurve", true),
        createPoint("cornerEnd", 10, 20, "onCurve", false),
      ]),
    ]);

    const selected = new Set(["handleSel" as PointId]);
    const { pointUpdates: moves, matched } = runConstrainDrag(glyph, selected, 5, 0);

    expect(matched.some((r) => r.ruleId === "maintainCollinearity")).toBe(true);
    expect(moves.every((move) => Number.isFinite(move.x) && Number.isFinite(move.y))).toBe(true);

    const selectedMove = moves.find((m) => m.id === "handleSel");
    expect(selectedMove?.x).toBe(5);
    expect(selectedMove?.y).toBe(20);
  });
});
