import type { GlyphOpenResult } from "@/types/glyphCatalog";

/** Allows only the latest asynchronous glyph-open request to publish. */
export class GlyphOpenGate {
  #generation = 0;

  /**
   * Loads a glyph and permits publication only while it remains the latest request.
   *
   * @param load - asynchronous glyph acquisition started for this request.
   * @returns the loaded current glyph, or `stale` after a newer request or invalidation.
   */
  async open<T>(load: () => Promise<T>): Promise<GlyphOpenResult<T>> {
    const generation = ++this.#generation;
    const glyph = await load();
    if (generation !== this.#generation) return { status: "stale" };

    return { status: "current", glyph };
  }

  /** Invalidates every request that began before this call. */
  invalidate(): void {
    this.#generation++;
  }
}
