import type { FontMetrics } from "@shift/types";
import { LRUCache } from "@/lib/cache/LRUCache";
import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";
import { getNative, hasNative } from "@/engine/native";

const SVG_PATH_CACHE_SIZE = 500;

const DEFAULT_VERSION = 0;

export class GlyphOutlineStore {
  #svgCache: LRUCache<number, string>;
  #advanceCache: LRUCache<number, number>;
  #fontUnicodes: WritableSignal<number[]>;
  #fontLoaded: WritableSignal<boolean>;
  #fontMetrics: WritableSignal<FontMetrics | null>;
  #glyphVersions = new Map<number, WritableSignal<number>>();

  constructor() {
    this.#svgCache = new LRUCache<number, string>({ max: SVG_PATH_CACHE_SIZE });
    this.#advanceCache = new LRUCache<number, number>({ max: SVG_PATH_CACHE_SIZE });
    this.#fontUnicodes = signal<number[]>([]);
    this.#fontLoaded = signal(false);
    this.#fontMetrics = signal<FontMetrics | null>(null);
  }

  onFontLoaded(unicodes: number[], metrics?: FontMetrics): void {
    this.#svgCache.clear();
    this.#advanceCache.clear();
    this.#glyphVersions.clear();
    this.#fontUnicodes.set(unicodes);
    this.#fontLoaded.set(true);
    this.#fontMetrics.set(metrics ?? null);
  }

  onFontUnloaded(): void {
    this.#svgCache.clear();
    this.#advanceCache.clear();
    this.#glyphVersions.clear();
    this.#fontUnicodes.set([]);
    this.#fontLoaded.set(false);
    this.#fontMetrics.set(null);
  }

  getSvgPath(unicode: number): string | null {
    const cached = this.#svgCache.get(unicode);
    if (cached !== undefined) return cached;
    if (!hasNative()) return null;
    const path = getNative().getGlyphSvgPath(unicode);
    if (path != null) this.#svgCache.set(unicode, path);
    return path ?? null;
  }

  getAdvance(unicode: number): number | null {
    const cached = this.#advanceCache.get(unicode);
    if (cached !== undefined) return cached;
    if (!hasNative()) return null;
    const advance = getNative().getGlyphAdvance(unicode);
    if (advance != null) this.#advanceCache.set(unicode, advance);
    return advance ?? null;
  }

  getBbox(unicode: number): [number, number, number, number] | null {
    if (!hasNative()) return null;
    const b = getNative().getGlyphBbox(unicode);
    if (b == null || b.length !== 4) return null;
    return [b[0], b[1], b[2], b[3]];
  }

  hasGlyph(unicode: number): boolean {
    return this.#fontUnicodes.peek().includes(unicode);
  }

  hasCachedPath(unicode: number): boolean {
    return this.#svgCache.has(unicode);
  }

  invalidateGlyph(unicode: number): void {
    this.#svgCache.delete(unicode);
    this.#advanceCache.delete(unicode);
    let v = this.#glyphVersions.get(unicode);
    if (!v) {
      v = signal(DEFAULT_VERSION);
      this.#glyphVersions.set(unicode, v);
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

export const glyphOutlineStore = new GlyphOutlineStore();
