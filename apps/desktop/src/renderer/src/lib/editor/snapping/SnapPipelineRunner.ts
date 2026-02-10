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

/**
 * Executes an ordered list of snap steps and resolves the winning result.
 *
 * Stateless — all mutable context lives in the {@link SnapContext} inside `args`.
 * The runner is shared across drag and rotate snap sessions; each session provides
 * its own step list and args.
 */
export class SnapPipelineRunner {
  /**
   * Runs all point snap steps and returns the best result.
   *
   * Priority logic:
   * 1. **Point-to-point** — if any step produces a `"pointToPoint"` result the
   *    pipeline short-circuits and that result wins immediately.
   * 2. **Closest** — among remaining candidates (metrics, angle) the one nearest
   *    to the original point is chosen.
   * 3. **No match** — returns the input point unchanged with `source: null`.
   */
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

  /**
   * Runs all rotate snap steps and returns the first match.
   *
   * Uses **first-match** semantics: the first step that returns a non-null result
   * wins. If no step matches, the raw delta passes through with `source: null`.
   */
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
