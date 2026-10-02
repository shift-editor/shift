import type { GlyphId, GlyphName } from "@shift/types";
import type { SessionViewResumeRoute } from "@shared/viewResume";

export type GlyphRecordForResume = {
  id: GlyphId;
  name: GlyphName;
  unicode: number | null;
};

/**
 * Maps a stable preview route identity onto a workspace glyph id.
 *
 * @returns null when no unique match exists (caller falls back to home).
 */
export function matchResumeGlyph(
  glyphs: readonly GlyphRecordForResume[],
  route: SessionViewResumeRoute,
): GlyphId | null {
  if (glyphs.length === 0) return null;

  const byName = glyphs.filter((glyph) => glyph.name === route.glyphName);
  if (byName.length === 1) return byName[0]!.id;

  if (route.unicode !== null) {
    const byUnicode = glyphs.filter((glyph) => glyph.unicode === route.unicode);
    if (byUnicode.length === 1) return byUnicode[0]!.id;
  }

  if (byName.length > 1) return null;

  return null;
}
