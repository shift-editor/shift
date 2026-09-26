import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphId, GlyphName, GlyphRecord } from "@shift/types";
import type { ComponentCandidate } from "@/types/componentPicker";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

/**
 * Returns existing and creatable component candidates that cannot create a reference cycle.
 *
 * @param glyphs - Current-font catalog order to preserve in existing results.
 * @param records - Committed dependency records used for transitive cycle checks.
 * @param currentGlyphId - Glyph that will own the new component occurrence.
 * @param query - Name, character, or Unicode notation to match.
 * @param glyphInfo - Unicode metadata used for related ranking and missing-glyph search.
 * @returns Related decomposition candidates first, followed by current-font and searched Unicode matches.
 */
export function componentPickerCandidates(
  glyphs: readonly GlyphCatalogItem[],
  records: readonly GlyphRecord[],
  currentGlyphId: GlyphId,
  query: string,
  glyphInfo: GlyphInfo,
): ComponentCandidate[] {
  const existingGlyphs = componentPickerGlyphs(glyphs, records, currentGlyphId, query, glyphInfo);
  const candidates: ComponentCandidate[] = existingGlyphs.map((glyph) => ({
    availability: "existing",
    glyphId: glyph.id,
    name: glyph.name,
    displayName: glyph.displayName,
    unicode: glyph.unicode,
  }));
  const currentFontCodepoints = new Set(
    glyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [glyph.unicode])),
  );
  const currentFontNames = new Set(glyphs.map(({ name }) => name.toLowerCase()));

  if (query.trim() === "") {
    const currentGlyph = glyphs.find(({ id }) => id === currentGlyphId);
    if (!currentGlyph) return candidates;

    const canonicalName = glyphInfo.resolveGlyphName(currentGlyph.name, currentGlyph.unicode);
    const baseName = canonicalName.split(".")[0] ?? canonicalName;
    const unicode = currentGlyph.unicode ?? glyphInfo.getGlyphByName(baseName)?.codepoint ?? null;
    const decomposition = unicode === null ? [] : glyphInfo.getDecomposition(unicode);
    const existingByUnicode = new Map(
      candidates.flatMap((candidate) =>
        candidate.unicode === null ? [] : [[candidate.unicode, candidate]],
      ),
    );
    const existingByName = new Map(
      candidates.map((candidate) => [candidate.name.toLowerCase(), candidate]),
    );
    const relatedCandidates: ComponentCandidate[] = [];
    const relatedGlyphIds = new Set<GlyphId>();

    for (const codepoint of decomposition) {
      const glyph = glyphInfo.getGlyph(codepoint);
      const existingCandidate =
        existingByUnicode.get(codepoint) ??
        (glyph ? existingByName.get(glyph.name.toLowerCase()) : undefined);
      if (existingCandidate?.glyphId && !relatedGlyphIds.has(existingCandidate.glyphId)) {
        relatedCandidates.push(existingCandidate);
        relatedGlyphIds.add(existingCandidate.glyphId);
        continue;
      }
      if (
        !glyph ||
        currentFontCodepoints.has(codepoint) ||
        currentFontNames.has(glyph.name.toLowerCase())
      ) {
        continue;
      }

      relatedCandidates.push({
        availability: "missing",
        glyphId: null,
        name: glyph.name as GlyphName,
        displayName: glyph.name,
        unicode: codepoint,
      });
    }

    return [
      ...relatedCandidates,
      ...candidates.filter(
        (candidate) => candidate.glyphId === null || !relatedGlyphIds.has(candidate.glyphId),
      ),
    ];
  }

  const eligibleGlyphs = componentPickerGlyphs(glyphs, records, currentGlyphId, "", glyphInfo);
  const eligibleByUnicode = new Map(
    eligibleGlyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [[glyph.unicode, glyph]])),
  );
  const rankedCandidates: ComponentCandidate[] = [];
  const includedGlyphIds = new Set<GlyphId>();
  const includedCodepoints = new Set<number>();
  const normalizedQuery = query.trim().toLowerCase();
  const directUnicode = unicodeFromQuery(query);
  const directName = glyphInfo.resolveGlyphName(query.trim());
  const directNameGlyph = glyphInfo.getGlyphByName(directName);
  const matchingCodepoints = [
    ...(directUnicode === null ? [] : [directUnicode]),
    ...(directNameGlyph ? [directNameGlyph.codepoint] : []),
    ...glyphInfo.search(query).map(({ codepoint }) => codepoint),
  ];

  for (const candidate of candidates) {
    if (candidate.glyphId === null) continue;
    if (
      candidate.name.toLowerCase() !== normalizedQuery &&
      candidate.displayName.toLowerCase() !== normalizedQuery
    ) {
      continue;
    }

    rankedCandidates.push(candidate);
    includedGlyphIds.add(candidate.glyphId);
    if (candidate.unicode !== null) includedCodepoints.add(candidate.unicode);
  }

  for (const codepoint of matchingCodepoints) {
    if (includedCodepoints.has(codepoint)) continue;

    const existingGlyph = eligibleByUnicode.get(codepoint);
    if (existingGlyph) {
      if (includedGlyphIds.has(existingGlyph.id)) continue;

      rankedCandidates.push({
        availability: "existing",
        glyphId: existingGlyph.id,
        name: existingGlyph.name,
        displayName: existingGlyph.displayName,
        unicode: existingGlyph.unicode,
      });
      includedGlyphIds.add(existingGlyph.id);
      includedCodepoints.add(codepoint);
      continue;
    }
    if (currentFontCodepoints.has(codepoint)) continue;

    const glyph = glyphInfo.getGlyph(codepoint);
    if (!glyph || currentFontNames.has(glyph.name.toLowerCase())) continue;

    rankedCandidates.push({
      availability: "missing",
      glyphId: null,
      name: glyph.name as GlyphName,
      displayName: glyph.name,
      unicode: codepoint,
    });
    includedCodepoints.add(codepoint);
  }

  for (const candidate of candidates) {
    if (candidate.glyphId === null || includedGlyphIds.has(candidate.glyphId)) continue;

    rankedCandidates.push(candidate);
    includedGlyphIds.add(candidate.glyphId);
  }

  return rankedCandidates;
}

function componentPickerGlyphs(
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
