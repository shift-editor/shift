export class GlyphRenderCache {
  static #cache = new Map<string | number, Path2D>();

  static get(key: string | number, svgPath: string): Path2D {
    let cached = this.#cache.get(key);
    if (cached) return cached;
    cached = new Path2D(svgPath);
    this.#cache.set(key, cached);
    return cached;
  }

  static delete(key: string | number): void {
    this.#cache.delete(key);
  }

  static clear(): void {
    this.#cache.clear();
  }

  static get size(): number {
    return this.#cache.size;
  }
}
