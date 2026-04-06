import type { Bounds as BoundsType } from "@shift/geo";
import type { SegmentContourLike } from "@shift/font";

type CachedContourGeometry = {
  path: Path2D;
  isClosed: boolean;
  bounds: BoundsType | null;
};

export class GlyphRenderCache {
  static #svgPathCache = new Map<string | number, Path2D>();
  static #contourPathCache = new WeakMap<SegmentContourLike, CachedContourGeometry>();

  static get(key: string | number, svgPath: string): Path2D {
    let cached = this.#svgPathCache.get(key);
    if (cached) return cached;
    cached = new Path2D(svgPath);
    this.#svgPathCache.set(key, cached);
    return cached;
  }

  static getContourPath(contour: SegmentContourLike): CachedContourGeometry | undefined {
    return this.#contourPathCache.get(contour);
  }

  static setContourPath(contour: SegmentContourLike, geometry: CachedContourGeometry): void {
    this.#contourPathCache.set(contour, geometry);
  }

  static delete(key: string | number): void {
    this.#svgPathCache.delete(key);
  }

  static clear(): void {
    this.#svgPathCache.clear();
    this.#contourPathCache = new WeakMap();
  }

  static get size(): number {
    return this.#svgPathCache.size;
  }
}
