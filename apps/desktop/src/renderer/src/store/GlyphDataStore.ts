import type { FontMetrics } from "@shift/types";
import type { Bounds } from "@shift/geo";
import { Bounds as BoundsUtil } from "@shift/geo";
import { LRUCache } from "@/lib/cache/LRUCache";
import { GlyphRenderCache } from "@/lib/cache/GlyphRenderCache";
import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";
import { getNative, hasNative } from "@/engine/native";

const CACHE_SIZE = 500;

const DEFAULT_VERSION = 0;

interface GlyphData {
  svgPath?: string;
  advance?: number;
  bbox?: Bounds;
}

export class GlyphDataStore {
  #cache: LRUCache<number, GlyphData>;
  #cacheByName: LRUCache<string, GlyphData>;
  #fontUnicodes: WritableSignal<number[]>;
  #fontLoaded: WritableSignal<boolean>;
  #fontMetrics: WritableSignal<FontMetrics | null>;
  #glyphVersions = new Map<number, WritableSignal<number>>();
  #glyphVersionsByName = new Map<string, WritableSignal<number>>();

  constructor() {
    this.#cache = new LRUCache<number, GlyphData>({ max: CACHE_SIZE });
    this.#cacheByName = new LRUCache<string, GlyphData>({ max: CACHE_SIZE });
    this.#fontUnicodes = signal<number[]>([]);
    this.#fontLoaded = signal(false);
    this.#fontMetrics = signal<FontMetrics | null>(null);
  }

  onFontLoaded(unicodes: number[], metrics?: FontMetrics): void {
    this.#cache.clear();
    this.#cacheByName.clear();
    this.#glyphVersions.clear();
    this.#glyphVersionsByName.clear();
    GlyphRenderCache.clear();
    this.#fontUnicodes.set(unicodes);
    this.#fontLoaded.set(true);
    this.#fontMetrics.set(metrics ?? null);
  }

  onFontUnloaded(): void {
    this.#cache.clear();
    this.#cacheByName.clear();
    this.#glyphVersions.clear();
    this.#glyphVersionsByName.clear();
    GlyphRenderCache.clear();
    this.#fontUnicodes.set([]);
    this.#fontLoaded.set(false);
    this.#fontMetrics.set(null);
  }

  getSvgPath(unicode: number): string | null {
    const entry = this.#cache.get(unicode);
    if (entry?.svgPath !== undefined) return entry.svgPath;
    if (!hasNative()) return null;
    const path = getNative().getGlyphSvgPath(unicode);
    if (path != null) {
      const existing = this.#cache.get(unicode) ?? {};
      this.#cache.set(unicode, { ...existing, svgPath: path });
    }
    return path ?? null;
  }

  getSvgPathByName(glyphName: string): string | null {
    const entry = this.#cacheByName.get(glyphName);
    if (entry?.svgPath !== undefined) return entry.svgPath;
    if (!hasNative()) return null;
    const path = getNative().getGlyphSvgPathByName(glyphName);
    if (path != null) {
      const existing = this.#cacheByName.get(glyphName) ?? {};
      this.#cacheByName.set(glyphName, { ...existing, svgPath: path });
    }
    return path ?? null;
  }

  getAdvance(unicode: number): number | null {
    const entry = this.#cache.get(unicode);
    if (entry?.advance !== undefined) return entry.advance;
    if (!hasNative()) return null;
    const advance = getNative().getGlyphAdvance(unicode);
    if (advance != null) {
      const existing = this.#cache.get(unicode) ?? {};
      this.#cache.set(unicode, { ...existing, advance });
    }
    return advance ?? null;
  }

  getAdvanceByName(glyphName: string): number | null {
    const entry = this.#cacheByName.get(glyphName);
    if (entry?.advance !== undefined) return entry.advance;
    if (!hasNative()) return null;
    const advance = getNative().getGlyphAdvanceByName(glyphName);
    if (advance != null) {
      const existing = this.#cacheByName.get(glyphName) ?? {};
      this.#cacheByName.set(glyphName, { ...existing, advance });
    }
    return advance ?? null;
  }

  getBbox(unicode: number): Bounds | null {
    const entry = this.#cache.get(unicode);
    if (entry?.bbox !== undefined) return entry.bbox;
    if (!hasNative()) return null;
    const b = getNative().getGlyphBbox(unicode);
    if (b == null || b.length !== 4) return null;
    const bounds = BoundsUtil.create({ x: b[0], y: b[1] }, { x: b[2], y: b[3] });
    const existing = this.#cache.get(unicode) ?? {};
    this.#cache.set(unicode, { ...existing, bbox: bounds });
    return bounds;
  }

  getBboxByName(glyphName: string): Bounds | null {
    const entry = this.#cacheByName.get(glyphName);
    if (entry?.bbox !== undefined) return entry.bbox;
    if (!hasNative()) return null;
    const b = getNative().getGlyphBboxByName(glyphName);
    if (b == null || b.length !== 4) return null;
    const bounds = BoundsUtil.create({ x: b[0], y: b[1] }, { x: b[2], y: b[3] });
    const existing = this.#cacheByName.get(glyphName) ?? {};
    this.#cacheByName.set(glyphName, { ...existing, bbox: bounds });
    return bounds;
  }

  hasGlyph(unicode: number): boolean {
    return this.#fontUnicodes.peek().includes(unicode);
  }

  hasCachedPath(unicode: number): boolean {
    return this.#cache.get(unicode)?.svgPath !== undefined;
  }

  invalidateGlyph(unicode: number): void {
    this.#cache.delete(unicode);
    GlyphRenderCache.delete(unicode);
    let v = this.#glyphVersions.get(unicode);
    if (!v) {
      v = signal(DEFAULT_VERSION);
      this.#glyphVersions.set(unicode, v);
    }
    v.set(v.peek() + 1);
  }

  invalidateGlyphByName(glyphName: string): void {
    this.#cacheByName.delete(glyphName);
    GlyphRenderCache.delete(glyphName);
    let v = this.#glyphVersionsByName.get(glyphName);
    if (!v) {
      v = signal(DEFAULT_VERSION);
      this.#glyphVersionsByName.set(glyphName, v);
    }
    v.set(v.peek() + 1);
  }

  getGlyphVersion(unicode: number): Signal<number> {
    let v = this.#glyphVersions.get(unicode);
    if (!v) {
      v = signal(DEFAULT_VERSION);
      this.#glyphVersions.set(unicode, v);
    }
    return v;
  }

  getGlyphVersionByName(glyphName: string): Signal<number> {
    let v = this.#glyphVersionsByName.get(glyphName);
    if (!v) {
      v = signal(DEFAULT_VERSION);
      this.#glyphVersionsByName.set(glyphName, v);
    }
    return v;
  }

  get fontLoaded(): Signal<boolean> {
    return this.#fontLoaded;
  }

  get fontUnicodes(): Signal<number[]> {
    return this.#fontUnicodes;
  }

  get fontMetrics(): Signal<FontMetrics | null> {
    return this.#fontMetrics;
  }
}

export const MARGIN_TOP_RATIO = 0.2;
export const MARGIN_BOTTOM_RATIO = 0.05;
export const MARGIN_SIDE_RATIO = 0;

export function glyphPreviewViewBox(metrics: FontMetrics | null, advance: number | null): string {
  if (!metrics) {
    return "0 -800 1000 1000";
  }
  const upm = metrics.unitsPerEm;
  const marginTop = upm * MARGIN_TOP_RATIO;
  const marginBottom = upm * MARGIN_BOTTOM_RATIO;
  const marginSide = upm * MARGIN_SIDE_RATIO;
  const x = -marginSide;
  const y = -(metrics.ascender + marginTop);
  const w = Math.max(1, (advance ?? upm) + 2 * marginSide);
  const h = metrics.ascender - metrics.descender + marginTop + marginBottom;
  return `${x} ${y} ${w} ${h}`;
}

export function computeViewBoxHeight(metrics: FontMetrics): number {
  const upm = metrics.unitsPerEm;
  const marginTop = upm * MARGIN_TOP_RATIO;
  const marginBottom = upm * MARGIN_BOTTOM_RATIO;
  return metrics.ascender - metrics.descender + marginTop + marginBottom;
}

export const glyphDataStore = new GlyphDataStore();
