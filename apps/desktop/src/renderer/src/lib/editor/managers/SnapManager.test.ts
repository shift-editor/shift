import { describe, expect, it } from "vitest";
import { asPointId, type FontMetrics, type PointId } from "@shift/types";
import { EditorSnapManager } from "./EditorSnapManager";

describe("EditorSnapManager", () => {
  const metrics: FontMetrics = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    xHeight: 500,
    lineGap: null,
    italicAngle: null,
    underlinePosition: null,
    underlineThickness: null,
  };

  function createManager() {
    return new EditorSnapManager({
      getGlyph: () => ({
        name: "A",
        xAdvance: 600,
        contours: [
          {
            id: "c1",
            closed: false,
            points: [
              { id: "p1" as PointId, x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
              { id: "p2" as PointId, x: 100, y: 100, pointType: "onCurve" as const, smooth: false },
            ],
          },
        ],
      }),
      getMetrics: () => metrics,
      getPreferences: () => ({
        enabled: true,
        angle: true,
        metrics: true,
        pointToPoint: true,
        pointRadiusPx: 8,
        angleIncrementDeg: 45,
      }),
      screenToUpmDistance: (px) => px,
    });
  }

  it("snaps point to nearest point target", () => {
    const manager = createManager();
    const session = manager.createDragSession({
      anchorPointId: asPointId("p1"),
      dragStart: { x: 0, y: 0 },
      excludedPointIds: [asPointId("p1")],
    });

    const result = session.snap({ x: 98, y: 99 }, { shiftKey: false });
    expect(result.point).toEqual({ x: 100, y: 100 });
    expect(result.source).toBe("pointToPoint");
    session.clear();
  });

  it("snaps angle when shift is pressed", () => {
    const manager = createManager();
    const session = manager.createDragSession({
      anchorPointId: asPointId("p1"),
      dragStart: { x: 0, y: 0 },
    });

    const result = session.snap({ x: 5, y: 2 }, { shiftKey: true });
    expect(result.point.y).toBeCloseTo(0);
    expect(result.source).toBe("angle");
    session.clear();
  });

  it("snaps rotate delta", () => {
    const manager = createManager();
    const session = manager.createRotateSession();

    const result = session.snap(Math.PI / 14, { shiftKey: true });
    expect(result.delta).toBeCloseTo(Math.PI / 12);
    expect(result.source).toBe("angle");
    session.clear();
  });
});
