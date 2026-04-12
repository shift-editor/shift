/**
 * Variation engine — caches interpolation results per location.
 *
 * Calls Rust's interpolateGlyph() once per glyph per location change.
 * Results cached in a Map, cleared on location change.
 * Pan/zoom/hover reads from cache — zero Rust calls.
 */

import type { GlyphSnapshot, Location } from "@shift/types";
import type { NativeBridge } from "@/bridge";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";

export class Variation {
  readonly #bridge: NativeBridge;
  readonly #$location: WritableSignal<Location | null>;
  #cache = new Map<string, GlyphSnapshot>();

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
    this.#$location = signal<Location | null>(null);
  }

  /** @knipclassignore */
  setLocation(location: Location | null): void {
    this.#cache.clear();
    this.#$location.set(location);
  }

  /** @knipclassignore */
  get location(): Location | null {
    return this.#$location.value;
  }

  get $location(): Signal<Location | null> {
    return this.#$location;
  }

  interpolate(name: string): GlyphSnapshot | null {
    // Read the signal to create reactive dependency
    const loc = this.#$location.value;
    if (!loc) return null;

    const cached = this.#cache.get(name);
    if (cached) return cached;

    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(loc.values)) {
      if (v !== undefined) values[k] = v;
    }

    const result = this.#bridge.interpolateGlyph(name, values);
    if (!result) return null;

    this.#cache.set(name, result.instance);
    return result.instance;
  }
}
