import type { Axis, GlyphSnapshot, ContourSnapshot, PointSnapshot } from "@shift/types";

/** A single master's glyph data with its design-space location. */
export interface MasterSnapshot {
  sourceId: string;
  sourceName: string;
  location: { values: { [key in string]?: number } };
  snapshot: GlyphSnapshot;
}

/** Normalize an axis value to the range [-1, 1]. */
export function normalizeAxisValue(value: number, axis: Axis): number {
  if (value < axis.default) {
    const range = axis.default - axis.minimum;
    return range < Number.EPSILON ? 0 : (value - axis.default) / range;
  }

  if (value > axis.default) {
    const range = axis.maximum - axis.default;
    return range < Number.EPSILON ? 0 : (value - axis.default) / range;
  }

  return 0;
}

/**
 * Check that all masters have compatible contour structure.
 * Returns null if compatible, or a description of the first incompatibility.
 */
export function checkCompatibility(masters: MasterSnapshot[]): string | null {
  if (masters.length < 2) return null;

  const ref = masters[0].snapshot;

  for (let m = 1; m < masters.length; m++) {
    const other = masters[m].snapshot;

    if (ref.contours.length !== other.contours.length) {
      return `Master "${masters[m].sourceName}" has ${other.contours.length} contours, expected ${ref.contours.length}`;
    }

    for (let c = 0; c < ref.contours.length; c++) {
      const refContour = ref.contours[c];
      const otherContour = other.contours[c];

      if (refContour.points.length !== otherContour.points.length) {
        return `Master "${masters[m].sourceName}" contour ${c}: ${otherContour.points.length} points, expected ${refContour.points.length}`;
      }
    }
  }

  return null;
}

/**
 * Interpolate a glyph at a target design-space location.
 *
 * For 2 masters on 1 axis this is simple linear interpolation:
 *   result = masterA * (1 - t) + masterB * t
 *
 * For N masters on M axes we compute per-master scalar weights
 * using bilinear/multilinear interpolation, then blend.
 */
export function interpolateGlyph(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): GlyphSnapshot | null {
  if (masters.length === 0) return null;
  if (masters.length === 1) return masters[0].snapshot;

  const error = checkCompatibility(masters);
  if (error) return null;

  const weights = computeMasterWeights(masters, axes, target);

  const ref = masters[0].snapshot;

  const contours: ContourSnapshot[] = ref.contours.map((refContour, ci) => ({
    id: refContour.id,
    closed: refContour.closed,
    points: refContour.points.map((refPoint, pi) =>
      blendPoint(
        masters.map((m) => m.snapshot.contours[ci].points[pi]),
        weights,
        refPoint,
      ),
    ),
  }));

  let xAdvance = 0;
  for (let i = 0; i < masters.length; i++) {
    xAdvance += masters[i].snapshot.xAdvance * weights[i];
  }

  return {
    ...ref,
    xAdvance,
    contours,
  };
}

function blendPoint(points: PointSnapshot[], weights: number[], ref: PointSnapshot): PointSnapshot {
  let x = 0;
  let y = 0;

  for (let i = 0; i < points.length; i++) {
    x += points[i].x * weights[i];
    y += points[i].y * weights[i];
  }

  return { ...ref, x, y };
}

/**
 * Compute scalar weights for each master given a target location.
 *
 * Uses bilinear/multilinear interpolation in normalized design space.
 * For the common 2-master / 1-axis case this reduces to simple lerp.
 */
function computeMasterWeights(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): number[] {
  if (masters.length === 2 && axes.length === 1) {
    return twoMasterWeights(masters, axes[0], target);
  }

  return generalWeights(masters, axes, target);
}

/** Fast path for the common 2-master / 1-axis case. */
function twoMasterWeights(
  masters: MasterSnapshot[],
  axis: Axis,
  target: Record<string, number>,
): number[] {
  const tag = axis.tag;
  const targetVal = target[tag] ?? axis.default;

  const valA = masters[0].location.values[tag] ?? axis.default;
  const valB = masters[1].location.values[tag] ?? axis.default;

  const range = valB - valA;
  if (Math.abs(range) < Number.EPSILON) return [0.5, 0.5];

  const t = Math.max(0, Math.min(1, (targetVal - valA) / range));
  return [1 - t, t];
}

/**
 * General N-master / M-axis interpolation using inverse-distance weighting
 * in normalized design space. This is a reasonable approximation for
 * arbitrary master configurations.
 */
function generalWeights(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): number[] {
  const normalizedTarget: Record<string, number> = {};
  for (const axis of axes) {
    normalizedTarget[axis.tag] = normalizeAxisValue(target[axis.tag] ?? axis.default, axis);
  }

  const distances: number[] = masters.map((master) => {
    let dist = 0;
    for (const axis of axes) {
      const masterVal = master.location.values[axis.tag] ?? axis.default;
      const nMaster = normalizeAxisValue(masterVal, axis);
      const diff = normalizedTarget[axis.tag] - nMaster;
      dist += diff * diff;
    }
    return Math.sqrt(dist);
  });

  // Check for exact match
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] < 1e-10) {
      const weights = Array.from({ length: masters.length }, () => 0);
      weights[i] = 1;
      return weights;
    }
  }

  // Inverse distance weighting
  const invDist = distances.map((d) => 1 / d);
  const sum = invDist.reduce((a, b) => a + b, 0);
  return invDist.map((w) => w / sum);
}
