import type { GlyphId, GlyphPreview, PackedGlyphPreview } from "@shift/types";
import { PackedOutlinePath } from "@/lib/graphics/PackedOutlinePath";

/** Drawable preview payload retained per glyph. */
export interface GlyphPreviewValue {
  readonly svgPath: string;
  readonly xAdvance: number;
  /** Present only for packed entries; constructed lazily and memoized. */
  readonly path?: Path2D;
  /** Canonical payload bytes retained by a packed entry. */
  readonly packedByteLength?: number;
}

/** Fixed per-entry overhead added to the payload in the byte ledger. */
const ENTRY_OVERHEAD_BYTES = 64;

function entryBytes(value: GlyphPreviewValue): number {
  if (value.packedByteLength !== undefined) {
    return value.packedByteLength + ENTRY_OVERHEAD_BYTES;
  }

  return value.svgPath.length * 2 + ENTRY_OVERHEAD_BYTES;
}

/**
 * Location-keyed, byte-budgeted LRU of drawable glyph previews.
 *
 * @remarks
 * Previews are only valid at one design location, so `rekey` empties the
 * cache whenever the location moves. Reads touch recency, keeping visible
 * glyphs hot; fills evict least-recently-used entries until the ledger fits
 * the budget again. SVG entries count `svgPath.length × 2` (UTF-16); packed
 * entries count canonical payload bytes. The fixed overhead covers the cache
 * record. Memoized renderer objects are a separate accounting concern.
 */
export class GlyphPreviewCache {
  readonly #budgetBytes: number;
  readonly #entries = new Map<GlyphId, GlyphPreviewValue>();
  #bytes = 0;
  #key = "";
  #version = 0;

  constructor(budgetBytes: number) {
    if (budgetBytes < 1) throw new Error("GlyphPreviewCache budget must be >= 1");
    this.#budgetBytes = budgetBytes;
  }

  get key(): string {
    return this.#key;
  }

  /** Bumped on every fill and rekey; cheap identity for reactive consumers. */
  get version(): number {
    return this.#version;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Empties the cache when the design location key changes. */
  rekey(key: string): void {
    if (key === this.#key) return;

    this.#entries.clear();
    this.#bytes = 0;
    this.#key = key;
    this.#version += 1;
  }

  has(glyphId: GlyphId): boolean {
    return this.#entries.has(glyphId);
  }

  /** Returns the preview and marks it most recently used. */
  get(glyphId: GlyphId): GlyphPreviewValue | null {
    const value = this.#entries.get(glyphId);
    if (!value) return null;

    this.#entries.delete(glyphId);
    this.#entries.set(glyphId, value);
    return value;
  }

  /** Inserts previews, evicting least-recently-used entries over budget. */
  fill(previews: readonly GlyphPreview[]): void {
    if (previews.length === 0) return;

    for (const preview of previews) {
      this.#insert(preview.glyphId, {
        svgPath: preview.svgPath,
        xAdvance: preview.xAdvance,
      });
    }

    this.#evict();
    this.#version += 1;
  }

  /** Validates and retains packed bytes without eagerly creating renderer objects. */
  fillPacked(previews: readonly PackedGlyphPreview[]): void {
    if (previews.length === 0) return;

    // Validate the complete response before publishing any part of the batch.
    const paths = previews.map((preview) => PackedOutlinePath.fromBytes(preview.data));
    for (const [index, preview] of previews.entries()) {
      const rendererPath = paths[index];
      this.#insert(preview.glyphId, {
        get svgPath() {
          return rendererPath.svgPath;
        },
        get path() {
          return rendererPath.path;
        },
        packedByteLength: rendererPath.outline.byteLength,
        xAdvance: preview.xAdvance,
      });
    }

    this.#evict();
    this.#version += 1;
  }

  /** Whether idle warm-up should stop rather than churn evictions. */
  nearBudget(): boolean {
    return this.#bytes >= this.#budgetBytes * 0.9;
  }

  #insert(glyphId: GlyphId, value: GlyphPreviewValue): void {
    const existing = this.#entries.get(glyphId);
    if (existing) {
      this.#bytes -= entryBytes(existing);
      this.#entries.delete(glyphId);
    }

    this.#entries.set(glyphId, value);
    this.#bytes += entryBytes(value);
  }

  #evict(): void {
    for (const [glyphId, value] of this.#entries) {
      if (this.#bytes <= this.#budgetBytes) break;

      this.#entries.delete(glyphId);
      this.#bytes -= entryBytes(value);
    }
  }
}
