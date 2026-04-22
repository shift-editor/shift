import { describe, it, expect } from "vitest";
import { SnapPipelineRunner } from "./SnapPipelineRunner";
import type {
  PointSnapStep,
  PointSnapStepArgs,
  PointStepResult,
  RotateSnapStep,
  RotateSnapStepArgs,
  RotateStepResult,
} from "./types";

const pointArgs: PointSnapStepArgs = {
  point: { x: 100, y: 100 },
  reference: { x: 0, y: 0 },
  modifiers: { shiftKey: false },
  context: { previousSnappedAngle: null },
  sources: [],
  preferences: {
    snapEnabled: true,
    snapToPoints: true,
    snapToMetrics: true,
    snapToAngles: true,
  },
  radius: 10,
  increment: 15,
};

function pointStep(id: string, result: PointStepResult | null): PointSnapStep {
  return { id, apply: () => result };
}

function hit(
  source: PointStepResult["source"],
  snappedPoint: PointStepResult["snappedPoint"],
): PointStepResult {
  return { source, snappedPoint, indicator: null };
}

describe("SnapPipelineRunner.runPointPipeline", () => {
  const runner = new SnapPipelineRunner();

  it("returns the input point unchanged when no step matches", () => {
    const result = runner.runPointPipeline([pointStep("a", null), pointStep("b", null)], pointArgs);

    expect(result.source).toBe(null);
    expect(result.point).toEqual(pointArgs.point);
  });

  it("point-to-point short-circuits and wins over a closer metrics candidate", () => {
    const applied: string[] = [];
    const steps: PointSnapStep[] = [
      { id: "p2p", apply: () => (applied.push("p2p"), hit("pointToPoint", { x: 110, y: 110 })) },
      { id: "metrics", apply: () => (applied.push("metrics"), hit("metrics", { x: 101, y: 101 })) },
    ];

    const result = runner.runPointPipeline(steps, pointArgs);

    expect(result.source).toBe("pointToPoint");
    expect(result.point).toEqual({ x: 110, y: 110 });
    expect(applied).toEqual(["p2p"]); // metrics step must not run after p2p match
  });

  it("without a point-to-point match, the closest candidate wins", () => {
    const steps: PointSnapStep[] = [
      pointStep("far-metrics", hit("metrics", { x: 120, y: 100 })), // 20 away
      pointStep("near-angle", hit("angle", { x: 105, y: 100 })), // 5 away
    ];

    const result = runner.runPointPipeline(steps, pointArgs);

    expect(result.source).toBe("angle");
    expect(result.point).toEqual({ x: 105, y: 100 });
  });
});

describe("SnapPipelineRunner.runRotatePipeline", () => {
  const runner = new SnapPipelineRunner();
  const rotateArgs: RotateSnapStepArgs = {
    delta: 0.3,
    modifiers: { shiftKey: false },
    context: { previousSnappedAngle: null },
    preferences: {
      snapEnabled: true,
      snapToPoints: true,
      snapToMetrics: true,
      snapToAngles: true,
    },
    increment: 15,
  };

  function rotateStep(id: string, result: RotateStepResult | null): RotateSnapStep {
    return { id, apply: () => result };
  }

  it("passes the raw delta through when no step matches", () => {
    const result = runner.runRotatePipeline([rotateStep("a", null)], rotateArgs);

    expect(result.source).toBe(null);
    expect(result.delta).toBe(0.3);
  });

  it("first match wins — later steps are never consulted", () => {
    const applied: string[] = [];
    const steps: RotateSnapStep[] = [
      {
        id: "first",
        apply: () => (
          applied.push("first"),
          { snappedDelta: 0.25, source: "angle", indicator: null }
        ),
      },
      {
        id: "second",
        apply: () => (
          applied.push("second"),
          { snappedDelta: 0.5, source: "angle", indicator: null }
        ),
      },
    ];

    const result = runner.runRotatePipeline(steps, rotateArgs);

    expect(result.delta).toBe(0.25);
    expect(applied).toEqual(["first"]);
  });
});
