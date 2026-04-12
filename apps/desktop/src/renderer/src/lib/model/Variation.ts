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
  defaultValues: Float64Array;
  deltas: Float64Array[];
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

      // Get properly decomposed deltas from Rust (forward differencing)
      const glyphDeltas = this.#bridge.computeGlyphDeltas(name);
      if (!glyphDeltas) continue;

      // Also need a default snapshot for unflatten template
      const masters = this.#bridge.getGlyphMasterSnapshots(name);
      if (!masters || masters.length < 2) continue;
      const defaultIdx = findDefaultMaster(masters);

      this.#defaults.set(name, masters[defaultIdx].snapshot);
      this.#deltas.set(name, {
        defaultValues: new Float64Array(glyphDeltas.defaultValues),
        deltas: glyphDeltas.deltas.map((d) => new Float64Array(d)),
      });
    }
  }

  /** @knipclassignore — re-fetch deltas from Rust after editing a glyph */
  updateEditingDeltas(glyphName: string, _currentSnapshot: GlyphSnapshot): void {
    // Re-fetch from Rust which has the updated master data
    this.#deltas.delete(glyphName);
    this.#defaults.delete(glyphName);
    this.loadMasters([glyphName]);
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

function applyWeightsToDeltas(
  defaultSnap: GlyphSnapshot,
  deltas: MasterDeltas,
  weights: number[],
): GlyphSnapshot {
  const result = new Float64Array(deltas.defaultValues.length);
  result.set(deltas.defaultValues);

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
