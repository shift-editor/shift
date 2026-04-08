/**
 * Reactive glyph data store.
 *
 * Provides lazily-created, self-invalidating glyph data keyed by glyph name.
 * Each entry is a reactive signal — reading it inside an effect or computed
 * automatically subscribes to updates. When the editing glyph changes (via
 * FontEngine.$glyph), the affected entry re-fetches from Rust automatically.
 *
 * Composite glyphs are computed signals that read their component signals.
 * Editing "A" automatically stales "À" (which uses A as a component) —
 * zero manual invalidation, zero dependency graph walking.
 */
import {
  signal,
  computed,
  effect,
  type Signal,
  type WritableSignal,
  type Effect,
} from "@/lib/reactive/signal";
import type { Bounds } from "@shift/geo";
import type { FontEngine } from "@/engine/FontEngine";

export interface ResolvedGlyph {
  name: string;
  unicode: number | null;
  advance: number;
  bbox: Bounds | null;
  path2d: Path2D | null;
  svgPath: string | null;
}

const MAX_ENTRIES = 2000;

export class GlyphStore {
  #entries = new Map<string, WritableSignal<ResolvedGlyph | null> | Signal<ResolvedGlyph | null>>();
  #accessOrder: string[] = [];
  #font: FontEngine;
  #effect: Effect;

  constructor(font: FontEngine) {
    this.#font = font;

    this.#effect = effect(() => {
      const glyph = font.$glyph.value;
      if (!glyph) return;

      const entry = this.#entries.get(glyph.name);
      if (!entry) return;

      if (this.#isWritable(entry)) {
        entry.set(this.#fetch(glyph.name));
      }
    });
  }

  get(name: string): Signal<ResolvedGlyph | null> {
    const existing = this.#entries.get(name);
    if (existing) {
      this.#touch(name);
      return existing;
    }

    const componentNames = this.#getComponentNames(name);

    if (componentNames) {
      return this.#createComposite(name, componentNames);
    }

    return this.#createSimple(name);
  }

  clear(): void {
    this.#entries.clear();
    this.#accessOrder = [];
  }

  dispose(): void {
    this.#effect.dispose();
    this.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  #createSimple(name: string): WritableSignal<ResolvedGlyph | null> {
    const entry = signal<ResolvedGlyph | null>(this.#fetch(name));
    this.#store(name, entry);
    return entry;
  }

  #createComposite(name: string, componentNames: string[]): Signal<ResolvedGlyph | null> {
    const entry = computed<ResolvedGlyph | null>(() => {
      for (const compName of componentNames) {
        this.get(compName).value;
      }
      return this.#fetch(name);
    });

    this.#store(name, entry);
    return entry;
  }

  #fetch(name: string): ResolvedGlyph | null {
    const svgPath = this.#font.getSvgPathByName(name);
    const advance = this.#font.getAdvanceByName(name) ?? 0;
    const bbox = this.#font.getBboxByName(name);

    return {
      name,
      unicode: null,
      advance,
      bbox,
      svgPath,
      path2d: svgPath ? new Path2D(svgPath) : null,
    };
  }

  #getComponentNames(glyphName: string): string[] | null {
    const composite = this.#font.getGlyphCompositeComponents(glyphName);
    if (!composite || composite.components.length === 0) return null;
    return composite.components.map((c) => c.componentGlyphName);
  }

  #store(
    name: string,
    entry: WritableSignal<ResolvedGlyph | null> | Signal<ResolvedGlyph | null>,
  ): void {
    this.#entries.set(name, entry);
    this.#accessOrder.push(name);
    this.#evict();
  }

  #touch(name: string): void {
    const idx = this.#accessOrder.indexOf(name);
    if (idx !== -1) {
      this.#accessOrder.splice(idx, 1);
    }
    this.#accessOrder.push(name);
  }

  #evict(): void {
    while (this.#entries.size > MAX_ENTRIES && this.#accessOrder.length > 0) {
      const oldest = this.#accessOrder.shift()!;
      this.#entries.delete(oldest);
    }
  }

  #isWritable(entry: Signal<ResolvedGlyph | null>): entry is WritableSignal<ResolvedGlyph | null> {
    return "set" in entry;
  }
}
