/**
 * Glyph interpolation engine using the OpenType VariationModel algorithm.
 *
 * Ported from Fontra's var-model.js which is itself a port of
 * fontTools.varLib.models.VariationModel. Uses support-region box-splitting
 * and delta decomposition for correct multilinear interpolation.
 *
 * Incompatible sources are handled per-source during delta computation
 * (matching Fontra's approach): if subItemwise throws for a source, that
 * source's delta is zeroed out rather than failing the whole interpolation.
 */
import type { Axis, GlyphSnapshot, ContourSnapshot, PointSnapshot } from "@shift/types";

/** A single master's glyph data with its design-space location. */
export interface MasterSnapshot {
  sourceId: string;
  sourceName: string;
  location: { values: { [key in string]?: number } };
  snapshot: GlyphSnapshot;
}

/** Per-source error from delta computation. */
export interface SourceError {
  sourceIndex: number;
  sourceName: string;
  message: string;
}

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

type SparseLocation = Record<string, number>;
type Support = Record<string, [lower: number, peak: number, upper: number]>;

function normalizeLocation(
  location: Record<string, number | undefined>,
  axes: Axis[],
): SparseLocation {
  const out: SparseLocation = {};
  for (const axis of axes) {
    const v = location[axis.tag] ?? axis.default;
    const n = normalizeAxisValue(v, axis);
    if (Math.abs(n) > 1e-14) {
      out[axis.tag] = n;
    }
  }
  return out;
}

export function checkCompatibility(masters: MasterSnapshot[]): string | null {
  if (masters.length < 2) return null;

  const ref = masters[0].snapshot;

  for (let m = 1; m < masters.length; m++) {
    const other = masters[m].snapshot;

    if (ref.contours.length !== other.contours.length) {
      return `Master "${masters[m].sourceName}" has ${other.contours.length} contours, expected ${ref.contours.length}`;
    }

    for (let c = 0; c < ref.contours.length; c++) {
      if (ref.contours[c].points.length !== other.contours[c].points.length) {
        return `Master "${masters[m].sourceName}" contour ${c}: ${other.contours[c].points.length} points, expected ${ref.contours[c].points.length}`;
      }
    }
  }

  return null;
}

//
// These operate on the structured glyph data directly. If two snapshots
// have different contour/point counts, the operation throws — callers
// catch per-source to handle incompatibility gracefully.

class IncompatibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleError";
  }
}

function subPoints(a: PointSnapshot[], b: PointSnapshot[]): PointSnapshot[] {
  if (a.length !== b.length) {
    throw new IncompatibleError(`point count ${a.length} vs ${b.length}`);
  }
  return a.map((ap, i) => ({ ...ap, x: ap.x - b[i].x, y: ap.y - b[i].y }));
}

function addPoints(a: PointSnapshot[], b: PointSnapshot[]): PointSnapshot[] {
  if (a.length !== b.length) {
    throw new IncompatibleError(`point count ${a.length} vs ${b.length}`);
  }
  return a.map((ap, i) => ({ ...ap, x: ap.x + b[i].x, y: ap.y + b[i].y }));
}

function mulScalarPoints(pts: PointSnapshot[], s: number): PointSnapshot[] {
  return pts.map((p) => ({ ...p, x: p.x * s, y: p.y * s }));
}

function subContours(a: ContourSnapshot[], b: ContourSnapshot[]): ContourSnapshot[] {
  if (a.length !== b.length) {
    throw new IncompatibleError(`contour count ${a.length} vs ${b.length}`);
  }
  return a.map((ac, i) => ({
    ...ac,
    points: subPoints(ac.points, b[i].points),
  }));
}

function addContours(a: ContourSnapshot[], b: ContourSnapshot[]): ContourSnapshot[] {
  if (a.length !== b.length) {
    throw new IncompatibleError(`contour count ${a.length} vs ${b.length}`);
  }
  return a.map((ac, i) => ({
    ...ac,
    points: addPoints(ac.points, b[i].points),
  }));
}

function mulScalarContours(contours: ContourSnapshot[], s: number): ContourSnapshot[] {
  return contours.map((c) => ({ ...c, points: mulScalarPoints(c.points, s) }));
}

/** Subtract snapshot B from A: A - B */
function subSnapshot(a: GlyphSnapshot, b: GlyphSnapshot): GlyphSnapshot {
  return {
    ...a,
    xAdvance: a.xAdvance - b.xAdvance,
    contours: subContours(a.contours, b.contours),
  };
}

/** Add snapshot B to A: A + B */
function addSnapshot(a: GlyphSnapshot, b: GlyphSnapshot): GlyphSnapshot {
  return {
    ...a,
    xAdvance: a.xAdvance + b.xAdvance,
    contours: addContours(a.contours, b.contours),
  };
}

/** Multiply all coordinates in a snapshot by a scalar */
function mulScalarSnapshot(snap: GlyphSnapshot, s: number): GlyphSnapshot {
  if (s === 1) return snap;
  return {
    ...snap,
    xAdvance: snap.xAdvance * s,
    contours: mulScalarContours(snap.contours, s),
  };
}

/** A zero-valued snapshot with the same structure as the reference. */
function zeroSnapshot(ref: GlyphSnapshot): GlyphSnapshot {
  return mulScalarSnapshot(ref, 0);
}

function supportScalar(location: SparseLocation, support: Support): number {
  let scalar = 1.0;
  for (const axis in support) {
    const [lower, peak, upper] = support[axis];
    if (peak === 0.0) continue;
    if (lower > peak || peak > upper) continue;
    if (lower < 0.0 && upper > 0.0) continue;

    const v = location[axis] ?? 0.0;
    if (v === peak) continue;
    if (v <= lower || upper <= v) return 0.0;
    if (v < peak) {
      scalar *= (v - lower) / (peak - lower);
    } else {
      scalar *= (v - upper) / (peak - upper);
    }
  }
  return scalar;
}

function locationsToRegions(locations: SparseLocation[]): Support[] {
  const minV: Record<string, number> = {};
  const maxV: Record<string, number> = {};
  for (const loc of locations) {
    for (const [k, v] of Object.entries(loc)) {
      minV[k] = Math.min(v, minV[k] ?? v);
      maxV[k] = Math.max(v, maxV[k] ?? v);
    }
  }

  return locations.map((loc) => {
    const region: Support = {};
    for (const [axis, locV] of Object.entries(loc)) {
      region[axis] = locV > 0 ? [0, locV, maxV[axis]] : [minV[axis], locV, 0];
    }
    return region;
  });
}

function locationToString(loc: SparseLocation): string {
  const sorted: SparseLocation = {};
  for (const key of Object.keys(loc).sort()) {
    sorted[key] = loc[key];
  }
  return JSON.stringify(sorted);
}

function isSuperset(set: Set<string>, keys: string[]): boolean {
  for (const k of keys) {
    if (!set.has(k)) return false;
  }
  return true;
}

function deepCompare(a: unknown[], b: unknown[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (itemA === undefined) return -1;
    if (itemB === undefined) return 1;
    if (Array.isArray(itemA) && Array.isArray(itemB)) {
      const r = deepCompare(itemA, itemB);
      if (r !== 0) return r;
    } else if (typeof itemA === "number" && typeof itemB === "number") {
      if (itemA < itemB) return -1;
      if (itemA > itemB) return 1;
    } else if (typeof itemA === "string" && typeof itemB === "string") {
      if (itemA < itemB) return -1;
      if (itemA > itemB) return 1;
    }
  }
  return 0;
}

interface VariationModelData {
  mapping: number[];
  reverseMapping: number[];
  supports: Support[];
  deltaWeights: Map<number, number>[];
}

function buildVariationModel(
  masterLocations: SparseLocation[],
  axisOrder: string[],
): VariationModelData {
  const axisPoints: Record<string, Set<number>> = {};
  for (const loc of masterLocations) {
    const keys = Object.keys(loc);
    if (keys.length !== 1) continue;
    const axis = keys[0];
    if (!axisPoints[axis]) axisPoints[axis] = new Set([0.0]);
    axisPoints[axis].add(loc[axis]);
  }

  const decorated: [unknown[], SparseLocation, number][] = masterLocations.map((loc, i) => {
    const entries = Object.entries(loc);
    const rank = entries.length;
    const onPointAxes: string[] = [];
    for (const [axis, value] of entries) {
      if (axisPoints[axis]?.has(value)) onPointAxes.push(axis);
    }
    const orderedAxes = [
      ...axisOrder.filter((a) => loc[a] !== undefined),
      ...Object.keys(loc)
        .sort()
        .filter((a) => !axisOrder.includes(a)),
    ];
    const deco: unknown[] = [
      rank,
      -onPointAxes.length,
      orderedAxes.map((a) => {
        const idx = axisOrder.indexOf(a);
        return idx !== -1 ? idx : 0x10000;
      }),
      orderedAxes,
      orderedAxes.map((a) => Math.sign(loc[a])),
      orderedAxes.map((a) => Math.abs(loc[a])),
    ];
    return [deco, loc, i];
  });

  decorated.sort((a, b) => deepCompare(a[0] as unknown[], b[0] as unknown[]));
  const sortedLocations = decorated.map((d) => d[1]);

  const locStrings = masterLocations.map(locationToString);
  const sortedStrings = sortedLocations.map(locationToString);
  const mapping = locStrings.map((s) => sortedStrings.indexOf(s));
  const reverseMapping = sortedStrings.map((s) => locStrings.indexOf(s));

  // Compute supports via box-splitting
  const regions = locationsToRegions(sortedLocations);
  const supports: Support[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = { ...regions[i] };
    for (const axis in region) {
      region[axis] = [...region[axis]];
    }
    const locAxes = new Set(Object.keys(region));

    for (let j = 0; j < i; j++) {
      const prevRegion = supports[j];
      if (!isSuperset(locAxes, Object.keys(prevRegion))) continue;

      let relevant = true;
      for (const [axis, [lower, , upper]] of Object.entries(region)) {
        const prev = prevRegion[axis];
        if (!prev || !(prev[1] === region[axis][1] || (lower < prev[1] && prev[1] < upper))) {
          relevant = false;
          break;
        }
      }
      if (!relevant) continue;

      let bestAxes: Record<string, [number, number, number]> = {};
      let bestRatio = -1;
      for (const axis of Object.keys(prevRegion)) {
        const val = prevRegion[axis][1];
        const [lower, locV, upper] = region[axis];
        let ratio: number;
        if (val < locV) {
          ratio = (val - locV) / (lower - locV);
          if (ratio > bestRatio) {
            bestAxes = {};
            bestRatio = ratio;
          }
          if (ratio === bestRatio) bestAxes[axis] = [val, locV, upper];
        } else if (locV < val) {
          ratio = (val - locV) / (upper - locV);
          if (ratio > bestRatio) {
            bestAxes = {};
            bestRatio = ratio;
          }
          if (ratio === bestRatio) bestAxes[axis] = [lower, locV, val];
        }
      }
      for (const axis in bestAxes) {
        region[axis] = bestAxes[axis];
      }
    }
    supports.push(region);
  }

  const deltaWeights: Map<number, number>[] = [];
  for (let i = 0; i < sortedLocations.length; i++) {
    const loc = sortedLocations[i];
    const dw = new Map<number, number>();
    for (let j = 0; j < i; j++) {
      const scalar = supportScalar(loc, supports[j]);
      if (scalar) dw.set(j, scalar);
    }
    deltaWeights.push(dw);
  }

  return { mapping, reverseMapping, supports, deltaWeights };
}

export interface InterpolationResult {
  instance: GlyphSnapshot;
  /** Sources that were incompatible and excluded from interpolation. */
  errors: SourceError[];
}

/**
 * Interpolate a glyph at a target design-space location using the
 * OpenType VariationModel algorithm (support regions + delta decomposition).
 *
 * Follows Fontra's approach: build the model with ALL sources, then handle
 * incompatibility per-source during delta computation. Incompatible sources
 * get a zero delta (no contribution) and are reported in `errors`.
 */
export function interpolateGlyph(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): InterpolationResult | null {
  if (masters.length === 0) return null;
  if (masters.length === 1) return { instance: masters[0].snapshot, errors: [] };

  // Normalize master locations (sparse: omit axes at default)
  const normalizedLocations = masters.map((m) => normalizeLocation(m.location.values, axes));

  // Deduplicate locations — keep only the first master at each location
  const seen = new Set<string>();
  const uniqueIndices: number[] = [];
  for (let i = 0; i < normalizedLocations.length; i++) {
    const key = locationToString(normalizedLocations[i]);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIndices.push(i);
    }
  }
  const uniqueMasters = uniqueIndices.map((i) => masters[i]);
  const uniqueLocations = uniqueIndices.map((i) => normalizedLocations[i]);

  if (uniqueMasters.length < 2) {
    return { instance: uniqueMasters[0]?.snapshot ?? masters[0].snapshot, errors: [] };
  }

  // The VariationModel requires a default location ({})
  const hasDefault = uniqueLocations.some((loc) => Object.keys(loc).length === 0);
  if (!hasDefault) return null;

  const axisOrder = axes.map((a) => a.tag);

  let model: VariationModelData;
  try {
    model = buildVariationModel(uniqueLocations, axisOrder);
  } catch {
    return null;
  }

  // Find the default master's snapshot (for zero-value reference)
  const defaultIdx = uniqueLocations.findIndex((loc) => Object.keys(loc).length === 0);
  const defaultSnapshot = uniqueMasters[defaultIdx].snapshot;

  // Compute deltas with per-source error handling.
  // If subSnapshot throws for a source, that source gets a zero delta.
  const errors: SourceError[] = [];
  const deltas: GlyphSnapshot[] = [];

  for (let i = 0; i < uniqueMasters.length; i++) {
    const masterValue = uniqueMasters[model.reverseMapping[i]].snapshot;

    try {
      let delta = masterValue;
      const weights = model.deltaWeights[i];
      for (const [j, weight] of weights.entries()) {
        const prev = weight === 1 ? deltas[j] : mulScalarSnapshot(deltas[j], weight);
        delta = subSnapshot(delta, prev);
      }
      deltas.push(delta);
    } catch (e) {
      // This source is incompatible — zero delta, no contribution.
      const originalIdx = model.reverseMapping[i];
      errors.push({
        sourceIndex: originalIdx,
        sourceName: uniqueMasters[originalIdx].sourceName,
        message: e instanceof Error ? e.message : String(e),
      });
      deltas.push(zeroSnapshot(defaultSnapshot));
    }
  }

  // Compute scalars at target location
  const normalizedTarget = normalizeLocation(target, axes);
  const scalars = model.supports.map((support) => supportScalar(normalizedTarget, support));

  // Interpolate: sum delta[i] * scalar[i]
  let result: GlyphSnapshot | null = null;
  for (let i = 0; i < scalars.length; i++) {
    if (!scalars[i]) continue;
    const contribution = mulScalarSnapshot(deltas[i], scalars[i]);
    result = result === null ? contribution : addSnapshot(result, contribution);
  }

  return {
    instance: result ?? defaultSnapshot,
    errors,
  };
}
