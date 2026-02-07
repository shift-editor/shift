export class GlyphRenderCache {
  static #cache = new Map<number, Path2D>();

  static get(unicode: number, svgPath: string): Path2D {
    let cached = this.#cache.get(unicode);
    if (cached) return cached;
    cached = new Path2D(svgPath);
    this.#cache.set(unicode, cached);
    return cached;
  }

  static delete(unicode: number): void {
    this.#cache.delete(unicode);
  }

  static clear(): void {
    this.#cache.clear();
  }

  static get size(): number {
    return this.#cache.size;
  }
}
