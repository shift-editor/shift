import { Vec2 } from "@shift/geo";
import type {
  PointSnapStep,
  PointSnapStepArgs,
  PointSnapResult,
  PointStepResult,
  RotateSnapStep,
  RotateSnapStepArgs,
  RotateSnapResult,
} from "./types";

export class SnapPipelineRunner {
  runPointPipeline(steps: readonly PointSnapStep[], args: PointSnapStepArgs): PointSnapResult {
    const candidates: PointStepResult[] = [];

    for (const step of steps) {
      const result = step.apply(args);
      if (result) {
        candidates.push(result);
        if (result.source === "pointToPoint") break;
      }
    }

    if (candidates.length === 0) {
      return { point: args.point, source: null, indicator: null };
    }

    const p2p = candidates.find((c) => c.source === "pointToPoint");
    if (p2p) {
      return { point: p2p.snappedPoint, source: p2p.source, indicator: p2p.indicator };
    }

    const best = candidates.reduce((a, b) =>
      Vec2.dist(a.snappedPoint, args.point) < Vec2.dist(b.snappedPoint, args.point) ? a : b,
    );

    return { point: best.snappedPoint, source: best.source, indicator: best.indicator };
  }

  runRotatePipeline(steps: readonly RotateSnapStep[], args: RotateSnapStepArgs): RotateSnapResult {
    for (const step of steps) {
      const result = step.apply(args);
      if (result) {
        return { delta: result.snappedDelta, source: result.source };
      }
    }

    return { delta: args.delta, source: null };
  }
}
