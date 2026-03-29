import { describe, expect, it } from "vitest";
import { GPU_HANDLE_INSTANCE_FLOATS } from "./types";
import { buildGpuHandleInstances, buildPackedGpuHandleInstances } from "./handleInstances";
import type { Glyph } from "@shift/types";
import { asContourId, asPointId } from "@shift/types";
import type { ViewportTransform } from "../CanvasCoordinator";

const glyph: Glyph = {
  name: "test",
  unicode: 65,
  xAdvance: 500,
  activeContourId: null,
  contours: [
    {
      id: asContourId("contour-1"),
      closed: true,
      points: [
        { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
        { id: asPointId("p2"), x: 50, y: 100, pointType: "offCurve", smooth: false },
        { id: asPointId("p3"), x: 100, y: 100, pointType: "offCurve", smooth: false },
        { id: asPointId("p4"), x: 150, y: 0, pointType: "onCurve", smooth: true },
      ],
    },
    {
      id: asContourId("contour-2"),
      closed: false,
      points: [
        { id: asPointId("p5"), x: 200, y: 0, pointType: "onCurve", smooth: false },
        { id: asPointId("p6"), x: 250, y: 75, pointType: "onCurve", smooth: false },
      ],
    },
  ],
  anchors: [],
  compositeContours: [],
};

const viewport: ViewportTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
  centre: { x: 500, y: 500 },
  upmScale: 1,
  logicalHeight: 1000,
  padding: 0,
  descender: 0,
};

describe("buildGpuHandleInstances", () => {
  it("maps point topology to GPU handle instances", () => {
    const instances = buildGpuHandleInstances(glyph, (pointId) =>
      pointId === asPointId("p4") ? "selected" : "idle",
    );

    expect(instances).toHaveLength(6);
    expect(instances.map((instance) => instance.shape)).toEqual([
      "direction",
      "control",
      "control",
      "smooth",
      "first",
      "last",
    ]);
  });

  it("preserves state-dependent sizing and color data", () => {
    const instances = buildGpuHandleInstances(glyph, (pointId) =>
      pointId === asPointId("p4") ? "selected" : "hovered",
    );
    const selectedSmooth = instances.find((instance) => instance.shape === "smooth");
    const hoveredFirst = instances.find((instance) => instance.shape === "first");

    expect(selectedSmooth?.size).toBe(4);
    expect(selectedSmooth?.lineWidth).toBe(4);
    expect(hoveredFirst?.overlayColor[3]).toBeGreaterThan(0);
  });

  it("packs instances directly into a reusable float buffer", () => {
    const first = buildPackedGpuHandleInstances(
      glyph,
      () => "idle",
      viewport,
      { x: 0, y: 0 },
      null,
    );
    const second = buildPackedGpuHandleInstances(
      glyph,
      () => "idle",
      viewport,
      { x: 0, y: 0 },
      first.packedInstances,
    );

    expect(first.instanceCount).toBe(6);
    expect(first.packedInstances.length).toBe(6 * GPU_HANDLE_INSTANCE_FLOATS);
    expect(second.packedInstances).toBe(first.packedInstances);
    expect(second.packedInstances[5]).toBe(3);
  });

  it("culls handles that are outside the viewport", () => {
    const culled = buildPackedGpuHandleInstances(
      glyph,
      () => "idle",
      viewport,
      { x: 10000, y: 0 },
      null,
    );

    expect(culled.instanceCount).toBe(0);
  });
});
