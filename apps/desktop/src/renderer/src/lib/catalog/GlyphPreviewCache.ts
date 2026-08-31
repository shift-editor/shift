import type { GlyphId, GlyphPreview } from "@shift/types";
import type { GlyphPreviewValue } from "@/types/glyphPreview";

const ENTRY_OVERHEAD_BYTES = 64;

function entryBytes(value: GlyphPreviewValue | null): number {
  return value ? value.svgPath.length * 2 + ENTRY_OVERHEAD_BYTES : ENTRY_OVERHEAD_BYTES;
}

/** Retains resolved SVG previews within one location-keyed byte budget. */
export class GlyphPreviewCache {
  readonly #budgetBytes: number;
  readonly #entries = new Map<GlyphId, GlyphPreviewValue | null>();
  #bytes = 0;
  #key = "";

  /**
   * Creates an empty preview cache.
   *
   * @param budgetBytes - Maximum estimated UTF-16 path payload and entry overhead.
   * @throws {Error} when the budget cannot hold any entry metadata.
   */
  constructor(budgetBytes: number) {
    if (budgetBytes < ENTRY_OVERHEAD_BYTES) {
      throw new Error(`GlyphPreviewCache budget must be >= ${ENTRY_OVERHEAD_BYTES}`);
    }
    this.#budgetBytes = budgetBytes;
  }

  get key(): string {
    return this.#key;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Clears previews when the design location key changes. */
  rekey(key: string): void {
    if (key === this.#key) return;

    this.clear();
    this.#key = key;
  }

  has(glyphId: GlyphId): boolean {
    return this.#entries.has(glyphId);
  }

  /** Returns a resolved preview and touches its recency; null represents a shapeless glyph. */
  get(glyphId: GlyphId): GlyphPreviewValue | null | undefined {
    const value = this.#entries.get(glyphId);
    if (value === undefined && !this.#entries.has(glyphId)) return undefined;

    this.#entries.delete(glyphId);
    this.#entries.set(glyphId, value ?? null);
    return value ?? null;
  }

  /** Publishes one complete request, including glyphs omitted by the preview source. */
  fill(glyphIds: readonly GlyphId[], previews: readonly GlyphPreview[]): void {
    const previewsByGlyphId = new Map(previews.map((preview) => [preview.glyphId, preview]));

    for (const glyphId of glyphIds) {
      const preview = previewsByGlyphId.get(glyphId);
      const value: GlyphPreviewValue | null = preview
        ? { svgPath: preview.svgPath, xAdvance: preview.xAdvance }
        : null;
      const existing = this.#entries.get(glyphId);
      if (existing !== undefined || this.#entries.has(glyphId)) {
        this.#bytes -= entryBytes(existing ?? null);
        this.#entries.delete(glyphId);
      }
      this.#entries.set(glyphId, value);
      this.#bytes += entryBytes(value);
    }

    for (const [glyphId, value] of this.#entries) {
      if (this.#bytes <= this.#budgetBytes) break;

      this.#entries.delete(glyphId);
      this.#bytes -= entryBytes(value);
    }
  }

  /** Removes stale glyphs, or every preview when the invalidation is unbounded. */
  invalidate(glyphIds: readonly GlyphId[] | null): void {
    if (glyphIds === null) {
      this.clear();
      return;
    }

    for (const glyphId of glyphIds) {
      const existing = this.#entries.get(glyphId);
      if (existing === undefined && !this.#entries.has(glyphId)) continue;

      this.#entries.delete(glyphId);
      this.#bytes -= entryBytes(existing ?? null);
    }
  }

  private clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
