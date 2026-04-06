/**
 * Glyph interpolation engine using the OpenType VariationModel algorithm.
 *
 * Ported from Fontra's var-model.js which is itself a port of
 * fontTools.varLib.models.VariationModel. Uses support-region box-splitting
 * and delta decomposition for correct multilinear interpolation.
 */
import type { Axis, GlyphSnapshot, ContourSnapshot, PointSnapshot } from "@shift/types";

/** A single master's glyph data with its design-space location. */
export interface MasterSnapshot {
  sourceId: string;
  sourceName: string;
  location: { values: { [key in string]?: number } };
  snapshot: GlyphSnapshot;
}

// ── Axis normalization ──────────────────────────────────────────────

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

// ── Compatibility check ─────────────────────────────────────────────

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

// ── OpenType VariationModel (ported from Fontra/fonttools) ──────────

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
  // Sort locations using fonttools' decorated sort
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
    // Deep-copy the region's arrays
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

      // Split box
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

  // Compute delta weights
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

// ── Flat array helpers for point data ───────────────────────────────

/** Flatten a snapshot's point coordinates + xAdvance into a single number[]. */
function snapshotToFlat(snapshot: GlyphSnapshot): number[] {
  const flat: number[] = [snapshot.xAdvance];
  for (const contour of snapshot.contours) {
    for (const pt of contour.points) {
      flat.push(pt.x, pt.y);
    }
  }
  return flat;
}

function flatSub(a: number[], b: number[]): number[] {
  const r: number[] = Array.from({ length: a.length });
  for (let i = 0; i < a.length; i++) r[i] = a[i] - b[i];
  return r;
}

function flatMulScalar(a: number[], s: number): number[] {
  const r: number[] = Array.from({ length: a.length });
  for (let i = 0; i < a.length; i++) r[i] = a[i] * s;
  return r;
}

function flatAdd(a: number[], b: number[]): number[] {
  const r: number[] = Array.from({ length: a.length });
  for (let i = 0; i < a.length; i++) r[i] = a[i] + b[i];
  return r;
}

/** Reconstruct a GlyphSnapshot from a flat array, using a reference for structure. */
function flatToSnapshot(flat: number[], ref: GlyphSnapshot): GlyphSnapshot {
  let idx = 0;
  const xAdvance = flat[idx++];

  const contours: ContourSnapshot[] = ref.contours.map((refContour) => ({
    id: refContour.id,
    closed: refContour.closed,
    points: refContour.points.map((refPt) => {
      const x = flat[idx++];
      const y = flat[idx++];
      return { ...refPt, x, y } as PointSnapshot;
    }),
  }));

  return { ...ref, xAdvance, contours };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fallback: inverse-distance weighted blending when the VariationModel
 * can't be built (e.g. default master filtered out for incompatibility).
 */
function directBlend(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): GlyphSnapshot | null {
  if (masters.length < 2) return masters[0]?.snapshot ?? null;

  const normalizedTarget: Record<string, number> = {};
  for (const axis of axes) {
    normalizedTarget[axis.tag] = normalizeAxisValue(target[axis.tag] ?? axis.default, axis);
  }

  const distances = masters.map((m) => {
    let dist = 0;
    for (const axis of axes) {
      const val = m.location.values[axis.tag] ?? axis.default;
      const n = normalizeAxisValue(val, axis);
      const diff = (normalizedTarget[axis.tag] ?? 0) - n;
      dist += diff * diff;
    }
    return Math.sqrt(dist);
  });

  // Exact match
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] < 1e-10) return masters[i].snapshot;
  }

  const invDist = distances.map((d) => 1 / d);
  const sum = invDist.reduce((a, b) => a + b, 0);
  const weights = invDist.map((w) => w / sum);

  const flats = masters.map((m) => snapshotToFlat(m.snapshot));
  let result = Array.from<number>({ length: flats[0].length }).fill(0);
  for (let i = 0; i < flats.length; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] += flats[i][j] * weights[i];
    }
  }

  return flatToSnapshot(result, masters[0].snapshot);
}

/**
 * Interpolate a glyph at a target design-space location using the
 * OpenType VariationModel algorithm (support regions + delta decomposition).
 */
export function interpolateGlyph(
  masters: MasterSnapshot[],
  axes: Axis[],
  target: Record<string, number>,
): GlyphSnapshot | null {
  if (masters.length === 0) return null;
  if (masters.length === 1) return masters[0].snapshot;

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

  if (uniqueMasters.length < 2) return uniqueMasters[0]?.snapshot ?? null;

  // Find the largest group of mutually compatible masters.
  // Build a compatibility signature per master: "contourCount:p0,p1,p2..."
  const signatures = uniqueMasters.map((m) => {
    const s = m.snapshot;
    return `${s.contours.length}:${s.contours.map((c) => c.points.length).join(",")}`;
  });

  // Find the most common signature
  const sigCounts = new Map<string, number>();
  for (const sig of signatures) {
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
  }
  let bestSig = signatures[0];
  let bestCount = 0;
  for (const [sig, count] of sigCounts) {
    if (count > bestCount) {
      bestSig = sig;
      bestCount = count;
    }
  }

  const compatIndices = signatures
    .map((sig, i) => (sig === bestSig ? i : -1))
    .filter((i) => i >= 0);
  const compatMasters = compatIndices.map((i) => uniqueMasters[i]);
  const compatLocations = compatIndices.map((i) => uniqueLocations[i]);

  if (compatMasters.length < 2) return compatMasters[0]?.snapshot ?? null;

  // The VariationModel requires a default location (empty object).
  // If the default master was filtered out, fall back to direct blending.
  const hasDefault = compatLocations.some((loc) => Object.keys(loc).length === 0);
  if (!hasDefault) {
    console.log("[interp] default filtered out. compatMasters:", compatMasters.length,
      "sigs:", [...sigCounts.entries()].map(([s, c]) => `${s}(${c})`));
    return directBlend(compatMasters, axes, target);
  }

  const axisOrder = axes.map((a) => a.tag);

  // Build model — wrap in try/catch for robustness
  let model: VariationModelData;
  try {
    model = buildVariationModel(compatLocations, axisOrder);
  } catch {
    return null;
  }

  // Flatten master values into number arrays
  const masterFlats = compatMasters.map((m) => snapshotToFlat(m.snapshot));

  // Compute deltas
  const deltas: number[][] = [];
  for (let i = 0; i < masterFlats.length; i++) {
    let delta = masterFlats[model.reverseMapping[i]];
    const weights = model.deltaWeights[i];
    for (const [j, weight] of weights.entries()) {
      delta =
        weight === 1 ? flatSub(delta, deltas[j]) : flatSub(delta, flatMulScalar(deltas[j], weight));
    }
    deltas.push(delta);
  }

  // Compute scalars at target location
  const normalizedTarget = normalizeLocation(target, axes);
  const scalars = model.supports.map((support) => supportScalar(normalizedTarget, support));

  // Interpolate: sum delta[i] * scalar[i]
  let result: number[] | null = null;
  for (let i = 0; i < scalars.length; i++) {
    if (!scalars[i]) continue;
    const contribution = flatMulScalar(deltas[i], scalars[i]);
    result = result === null ? contribution : flatAdd(result, contribution);
  }

  if (!result) return compatMasters[0].snapshot;

  return flatToSnapshot(result, compatMasters[0].snapshot);
}
