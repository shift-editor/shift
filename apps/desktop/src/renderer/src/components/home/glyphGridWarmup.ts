import type { GlyphId } from "@shift/types";

/**
 * Picks the next warm-up batch, radiating outward from the viewport.
 *
 * @remarks
 * Indices alternate below/above `centerIndex` so warming always benefits the
 * territory nearest the user first, and a post-scrub re-warm starts around
 * the viewport instead of at the top of the catalog. Covered ids (cached or
 * model-resident) are skipped; an empty result means the reachable catalog is
 * fully covered.
 *
 * @param glyphIds - Catalog ids in display order.
 * @param centerIndex - Catalog index of the first rendered glyph.
 * @param isCovered - Whether an id already has a preview or a live model.
 * @param chunkSize - Maximum ids to return.
 * @returns Ids to fetch next, nearest-first.
 */
export function nextWarmupChunk(
  glyphIds: readonly GlyphId[],
  centerIndex: number,
  isCovered: (glyphId: GlyphId) => boolean,
  chunkSize: number,
): GlyphId[] {
  const chunk: GlyphId[] = [];
  const count = glyphIds.length;
  if (count === 0 || chunkSize < 1) return chunk;

  const center = Math.min(Math.max(centerIndex, 0), count - 1);
  for (let step = 0; chunk.length < chunkSize && step < count * 2; step += 1) {
    const offset = step >> 1;
    const index = step % 2 === 0 ? center + offset : center - offset - 1;
    if (index < 0 || index >= count) continue;

    const glyphId = glyphIds[index]!;
    if (!isCovered(glyphId)) chunk.push(glyphId);
  }

  return chunk;
}
