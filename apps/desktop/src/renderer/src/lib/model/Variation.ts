/**
 * Variation engine — weights from Rust, deltas × apply in TS signals.
 *
 * Rust computes per-master scalar weights (once per location change).
 * TS holds master deltas as flat Float64Arrays and applies weights in
 * computed signals. The computeds cache results — pan/zoom/hover cost
 * zero. Only slider moves trigger recomputation.
 */

import type {
  GlyphSnapshot,
  ContourSnapshot,
  PointSnapshot,
  AnchorSnapshot,
  Location,
} from "@shift/types";
import type { NativeBridge } from "@/bridge";
import type { MasterSnapshot } from "@/lib/interpolation/interpolate";
import {
  signal,
  computed,
  type WritableSignal,
  type ComputedSignal,
  type Signal,
} from "@/lib/reactive/signal";

interface MasterDeltas {
  deltas: Float64Array[];
  valueLength: number;
}

export class Variation {
  readonly #bridge: NativeBridge;
  readonly #$location: WritableSignal<Location | null>;
  readonly #$weights: ComputedSignal<number[] | null>;
  readonly #deltas = new Map<string, MasterDeltas>();
  readonly #defaults = new Map<string, GlyphSnapshot>();

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
    this.#$location = signal<Location | null>(null);
    this.#$weights = computed(() => {
      const loc = this.#$location.value;
      if (!loc) return null;
      const result = this.#bridge.computeVariationWeights(loc.values as Record<string, number>);
      if (!result) return null;
      return result.weights;
    });
  }

  /** @knipclassignore */
  setLocation(location: Location | null): void {
    this.#$location.set(location);
  }

  /** @knipclassignore */
  get location(): Location | null {
    return this.#$location.value;
  }

  get $location(): Signal<Location | null> {
    return this.#$location;
  }

  loadMasters(glyphNames: string[]): void {
    for (const name of glyphNames) {
      if (this.#deltas.has(name)) continue;
      const masters = this.#bridge.getGlyphMasterSnapshots(name);
      if (!masters || masters.length < 2) continue;

      const defaultIdx = findDefaultMaster(masters);
      this.#defaults.set(name, masters[defaultIdx].snapshot);
      this.#deltas.set(name, computeDeltas(masters, defaultIdx));
    }
  }

  /** @knipclassignore */
  updateEditingDeltas(glyphName: string, currentSnapshot: GlyphSnapshot): void {
    const existing = this.#deltas.get(glyphName);
    if (!existing) return;

    const defaultVec = flattenSnapshot(currentSnapshot);
    const oldDefault = this.#defaults.get(glyphName);
    if (!oldDefault) return;

    this.#defaults.set(glyphName, currentSnapshot);

    // Recompute deltas relative to new default
    // delta[i] = master[i] - newDefault
    // We have: old delta[i] = master[i] - oldDefault
    // So: new delta[i] = old delta[i] + (oldDefault - newDefault)
    const oldDefaultVec = flattenSnapshot(oldDefault);
    const diff = new Float64Array(defaultVec.length);
    for (let j = 0; j < diff.length; j++) {
      diff[j] = oldDefaultVec[j] - defaultVec[j];
    }

    for (let i = 0; i < existing.deltas.length; i++) {
      const d = existing.deltas[i];
      const updated = new Float64Array(d.length);
      for (let j = 0; j < d.length; j++) {
        updated[j] = d[j] + diff[j];
      }
      existing.deltas[i] = updated;
    }
  }

  interpolate(name: string): GlyphSnapshot | null {
    const weights = this.#$weights.value;
    if (!weights) return null;

    const deltas = this.#deltas.get(name);
    if (!deltas) return null;

    const def = this.#defaults.get(name);
    if (!def) return null;

    return applyWeightsToDeltas(def, deltas, weights);
  }
}

function findDefaultMaster(masters: MasterSnapshot[]): number {
  for (let i = 0; i < masters.length; i++) {
    const vals = masters[i].location.values;
    const isDefault =
      !vals ||
      Object.keys(vals).length === 0 ||
      Object.values(vals).every((v) => v === undefined || v === 0);
    if (isDefault) return i;
  }
  return 0;
}

function computeDeltas(masters: MasterSnapshot[], defaultIdx: number): MasterDeltas {
  const defaultVec = flattenSnapshot(masters[defaultIdx].snapshot);
  const deltas: Float64Array[] = masters.map((m) => {
    const vec = flattenSnapshot(m.snapshot);
    const delta = new Float64Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      delta[i] = vec[i] - defaultVec[i];
    }
    return delta;
  });

  return { deltas, valueLength: defaultVec.length };
}

function flattenSnapshot(snap: GlyphSnapshot): Float64Array {
  let pointCount = 0;
  for (const c of snap.contours) {
    pointCount += c.points.length;
  }
  const anchorCount = snap.anchors.length;
  const len = 1 + pointCount * 2 + anchorCount * 2;
  const arr = new Float64Array(len);

  let idx = 0;
  arr[idx++] = snap.xAdvance;

  for (const contour of snap.contours) {
    for (const point of contour.points) {
      arr[idx++] = point.x;
      arr[idx++] = point.y;
    }
  }

  for (const anchor of snap.anchors) {
    arr[idx++] = anchor.x;
    arr[idx++] = anchor.y;
  }

  return arr;
}

function applyWeightsToDeltas(
  defaultSnap: GlyphSnapshot,
  deltas: MasterDeltas,
  weights: number[],
): GlyphSnapshot {
  const defaultVec = flattenSnapshot(defaultSnap);
  const result = new Float64Array(defaultVec.length);
  result.set(defaultVec);

  for (let i = 0; i < weights.length && i < deltas.deltas.length; i++) {
    const w = weights[i];
    if (Math.abs(w) < 1e-10) continue;
    const d = deltas.deltas[i];
    for (let j = 0; j < result.length; j++) {
      result[j] += w * d[j];
    }
  }

  return unflattenSnapshot(result, defaultSnap);
}

function unflattenSnapshot(values: Float64Array, template: GlyphSnapshot): GlyphSnapshot {
  let idx = 0;
  const xAdvance = values[idx++];

  const contours: ContourSnapshot[] = template.contours.map((tc) => {
    const points: PointSnapshot[] = tc.points.map((tp) => ({
      ...tp,
      x: values[idx++],
      y: values[idx++],
    }));
    return { ...tc, points };
  });

  const anchors: AnchorSnapshot[] = template.anchors.map((ta) => ({
    ...ta,
    x: values[idx++],
    y: values[idx++],
  }));

  return {
    ...template,
    xAdvance,
    contours,
    anchors,
  };
}
