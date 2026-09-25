import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphId, GlyphRecord } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

/**
 * Returns searchable component candidates that cannot create a reference cycle.
 *
 * @param glyphs - Catalog order to preserve in the picker results.
 * @param records - Committed dependency records used for transitive cycle checks.
 * @param currentGlyphId - Glyph that will own the new component occurrence.
 * @param query - Name, character, or Unicode notation to match.
 * @param glyphInfo - Unicode decomposition metadata used to rank empty-query suggestions.
 * @returns A fresh filtered array, with related glyphs first for an empty query.
 */
export function componentPickerGlyphs(
  glyphs: readonly GlyphCatalogItem[],
  records: readonly GlyphRecord[],
  currentGlyphId: GlyphId,
  query: string,
  glyphInfo: GlyphInfo,
): GlyphCatalogItem[] {
  const excludedGlyphIds = cycleProducingGlyphIds(records, currentGlyphId);
  const normalizedQuery = query.trim().toLowerCase();
  const unicodeQuery = unicodeFromQuery(query);

  const eligibleGlyphs = glyphs.filter((glyph) => {
    if (excludedGlyphIds.has(glyph.id)) return false;
    if (normalizedQuery === "") return true;

    return (
      glyph.name.toLowerCase().includes(normalizedQuery) ||
      glyph.displayName.toLowerCase().includes(normalizedQuery) ||
      (unicodeQuery !== null && glyph.unicode === unicodeQuery)
    );
  });
  if (normalizedQuery !== "") return eligibleGlyphs;

  return relatedGlyphsFirst(eligibleGlyphs, glyphs, records, currentGlyphId, glyphInfo);
}

function relatedGlyphsFirst(
  eligibleGlyphs: readonly GlyphCatalogItem[],
  glyphs: readonly GlyphCatalogItem[],
  records: readonly GlyphRecord[],
  currentGlyphId: GlyphId,
  glyphInfo: GlyphInfo,
): GlyphCatalogItem[] {
  const currentGlyph = glyphs.find(({ id }) => id === currentGlyphId);
  if (!currentGlyph) return [...eligibleGlyphs];

  const canonicalName = glyphInfo.resolveGlyphName(currentGlyph.name, currentGlyph.unicode);
  const baseName = canonicalName.split(".")[0] ?? canonicalName;
  const unicode = currentGlyph.unicode ?? glyphInfo.getGlyphByName(baseName)?.codepoint ?? null;
  const decomposition = unicode === null ? [] : glyphInfo.getDecomposition(unicode);
  const eligibleByUnicode = new Map(
    eligibleGlyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [[glyph.unicode, glyph]])),
  );
  const currentRecord = records.find(({ id }) => id === currentGlyphId);
  const relatedGlyphIds = [
    ...decomposition.flatMap((codepoint) => {
      const glyph = eligibleByUnicode.get(codepoint);
      return glyph ? [glyph.id] : [];
    }),
    ...(currentRecord?.componentBaseGlyphIds ?? []),
  ];
  const eligibleById = new Map(eligibleGlyphs.map((glyph) => [glyph.id, glyph]));
  const rankedGlyphs: GlyphCatalogItem[] = [];
  const rankedGlyphIds = new Set<GlyphId>();

  for (const glyphId of relatedGlyphIds) {
    const glyph = eligibleById.get(glyphId);
    if (!glyph || rankedGlyphIds.has(glyphId)) continue;

    rankedGlyphs.push(glyph);
    rankedGlyphIds.add(glyphId);
  }
  for (const glyph of eligibleGlyphs) {
    if (!rankedGlyphIds.has(glyph.id)) rankedGlyphs.push(glyph);
  }

  return rankedGlyphs;
}

function cycleProducingGlyphIds(
  records: readonly GlyphRecord[],
  currentGlyphId: GlyphId,
): ReadonlySet<GlyphId> {
  const dependentsById = new Map<GlyphId, GlyphId[]>();
  for (const record of records) {
    for (const baseGlyphId of record.componentBaseGlyphIds) {
      const dependents = dependentsById.get(baseGlyphId) ?? [];
      dependents.push(record.id);
      dependentsById.set(baseGlyphId, dependents);
    }
  }

  const excludedGlyphIds = new Set<GlyphId>();
  const pending = [currentGlyphId];
  while (pending.length > 0) {
    const glyphId = pending.pop();
    if (!glyphId || excludedGlyphIds.has(glyphId)) continue;

    excludedGlyphIds.add(glyphId);
    pending.push(...(dependentsById.get(glyphId) ?? []));
  }

  return excludedGlyphIds;
}

function unicodeFromQuery(query: string): number | null {
  const value = query.trim();
  const characters = [...value];
  if (characters.length === 1) return characters[0]?.codePointAt(0) ?? null;

  const notation = /^(?:u\+|uni)([0-9a-f]{2,6})$/i.exec(value);
  if (!notation?.[1]) return null;

  const unicode = Number.parseInt(notation[1], 16);
  return unicode <= 0x10ffff ? unicode : null;
}
