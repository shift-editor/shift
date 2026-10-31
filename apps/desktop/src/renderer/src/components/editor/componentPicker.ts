import type { Glyph as GlyphInfoGlyph, GlyphInfo } from "@shift/glyph-info";
import { EntityMap, type GlyphId, type GlyphName, type GlyphRecord } from "@shift/types";
import type { ComponentCandidate } from "@/types/componentPicker";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { NameQuery } from "@/lib/utils/NameQuery";

interface ComponentPickerIndex {
  readonly glyphInfo: GlyphInfo;
  readonly eligibleGlyphs: readonly GlyphCatalogItem[];
  readonly eligibleById: EntityMap<GlyphId, GlyphCatalogItem>;
  readonly eligibleByUnicode: EntityMap<number, GlyphCatalogItem>;
  readonly eligibleByName: EntityMap<string, GlyphCatalogItem>;
  readonly fontCodepoints: ReadonlySet<number>;
  readonly fontNames: ReadonlySet<string>;
  readonly relatedCodepoints: readonly number[];
  readonly componentBaseIds: readonly GlyphId[];
}

/**
 * Ranks the glyphs that can become components of one owner glyph.
 *
 * @remarks
 * Immutable: build one with {@link ComponentPicker.for} whenever the font, its
 * records, the owner or the glyph info changes, and ask it for
 * {@link ComponentPicker.candidates} on every query. Glyphs that would create a
 * component reference cycle are never offered.
 */
export class ComponentPicker {
  readonly #index: ComponentPickerIndex;

  private constructor(index: ComponentPickerIndex) {
    this.#index = index;
  }

  /**
   * Indexes a font's glyphs for picking components of one owner glyph.
   *
   * @param glyphs - Current-font catalog; its order is the order of unranked results.
   * @param records - Committed dependency records used for transitive cycle checks.
   * @param ownerId - Glyph that will own the new component occurrence.
   * @param glyphInfo - Unicode metadata for related suggestions and missing-glyph search.
   *   Build a new picker once its decomposition data loads.
   */
  static for(
    glyphs: readonly GlyphCatalogItem[],
    records: readonly GlyphRecord[],
    ownerId: GlyphId,
    glyphInfo: GlyphInfo,
  ): ComponentPicker {
    const excludedIds = cycleProducingGlyphIds(records, ownerId);
    const eligibleGlyphs = glyphs.filter(({ id }) => !excludedIds.has(id));
    const owner = glyphs.find(({ id }) => id === ownerId) ?? null;
    const ownerRecord = records.find(({ id }) => id === ownerId) ?? null;

    return new ComponentPicker({
      glyphInfo,
      eligibleGlyphs,
      eligibleById: new EntityMap(
        "glyph",
        eligibleGlyphs.map((glyph) => [glyph.id, glyph]),
      ),
      eligibleByUnicode: new EntityMap(
        "glyph",
        eligibleGlyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [[glyph.unicode, glyph]])),
      ),
      eligibleByName: new EntityMap(
        "glyph",
        eligibleGlyphs.map((glyph) => [glyph.name.toLowerCase(), glyph]),
      ),
      fontCodepoints: new Set(glyphs.flatMap(({ unicode }) => (unicode === null ? [] : [unicode]))),
      fontNames: new Set(glyphs.map(({ name }) => name.toLowerCase())),
      relatedCodepoints: owner ? decompositionOf(owner, glyphInfo) : [],
      componentBaseIds: owner ? (ownerRecord?.componentBaseGlyphIds ?? []) : [],
    });
  }

  /**
   * Returns existing and creatable component candidates for a query.
   *
   * @param query - Name, character, or Unicode notation (`U+0041`, `uni0041`) to match.
   *   An empty or blank query asks for suggestions.
   * @returns A fresh list. For an empty query: the owner's decomposition glyphs,
   *   its current component bases, then every other glyph in catalog order. For a
   *   query: exact name matches, code point matches, then other name matches.
   */
  candidates(query: string): ComponentCandidate[] {
    if (query.trim() === "") return this.#suggestions();

    return this.#search(query);
  }

  #suggestions(): ComponentCandidate[] {
    const { eligibleByUnicode, eligibleByName, eligibleById, glyphInfo } = this.#index;
    const list = new CandidateList();

    for (const codepoint of this.#index.relatedCodepoints) {
      const info = glyphInfo.getGlyph(codepoint);
      const existing =
        eligibleByUnicode.get(codepoint) ??
        (info ? eligibleByName.get(info.name.toLowerCase()) : null);
      const candidate = existing ? existingCandidate(existing) : this.#missing(codepoint);
      if (candidate) list.add(candidate);
    }
    for (const glyphId of this.#index.componentBaseIds) {
      const glyph = eligibleById.get(glyphId);
      if (glyph) list.add(existingCandidate(glyph));
    }
    for (const glyph of this.#index.eligibleGlyphs) list.add(existingCandidate(glyph));

    return list.candidates;
  }

  #search(query: string): ComponentCandidate[] {
    const { eligibleByUnicode, glyphInfo } = this.#index;
    const search = NameQuery.from(query);
    const queryUnicode = unicodeFromQuery(query);
    const nameMatches = this.#index.eligibleGlyphs.filter(
      (glyph) =>
        search.matchesText(glyph.name) ||
        search.matchesText(glyph.displayName) ||
        (queryUnicode !== null && glyph.unicode === queryUnicode),
    );
    const exactMatches = nameMatches.filter(
      (glyph) => search.isExactly(glyph.name) || search.isExactly(glyph.displayName),
    );
    const resolvedGlyph = glyphInfo.getGlyphByName(glyphInfo.resolveGlyphName(query.trim()));
    const matchingCodepoints = [
      ...(queryUnicode === null ? [] : [queryUnicode]),
      ...(resolvedGlyph ? [resolvedGlyph.codepoint] : []),
      ...glyphInfo.search(query).map(({ codepoint }) => codepoint),
    ];
    const list = new CandidateList();

    for (const glyph of exactMatches) list.add(existingCandidate(glyph));
    for (const codepoint of matchingCodepoints) {
      if (list.includesCodepoint(codepoint)) continue;

      const existing = eligibleByUnicode.get(codepoint);
      const candidate = existing ? existingCandidate(existing) : this.#missing(codepoint);
      if (candidate) list.add(candidate);
    }
    for (const glyph of nameMatches) list.add(existingCandidate(glyph));

    return list.candidates;
  }

  /** The creatable candidate for a code point, or null when the font already has it or glyph info does not know it. */
  #missing(codepoint: number): ComponentCandidate | null {
    if (this.#index.fontCodepoints.has(codepoint)) return null;

    const info = this.#index.glyphInfo.getGlyph(codepoint);
    if (!info || this.#index.fontNames.has(info.name.toLowerCase())) return null;

    return missingCandidate(info);
  }
}

/** Candidates in ranked order, each glyph and each missing code point listed once. */
class CandidateList {
  readonly candidates: ComponentCandidate[] = [];
  // non-reactive: lives for one candidates() call.
  readonly #glyphIds = new Set<GlyphId>();
  // non-reactive: lives for one candidates() call.
  readonly #codepoints = new Set<number>();

  /**
   * Appends a candidate unless its glyph, or for a missing glyph its code point,
   * is already listed.
   *
   * @remarks
   * An existing glyph is never dropped for sharing a code point with another
   * existing glyph, so every glyph of a font with duplicate encodings stays findable.
   */
  add(candidate: ComponentCandidate): void {
    if (this.#isListed(candidate)) return;

    if (candidate.glyphId !== null) this.#glyphIds.add(candidate.glyphId);
    if (candidate.unicode !== null) this.#codepoints.add(candidate.unicode);
    this.candidates.push(candidate);
  }

  includesCodepoint(codepoint: number): boolean {
    return this.#codepoints.has(codepoint);
  }

  #isListed(candidate: ComponentCandidate): boolean {
    switch (candidate.availability) {
      case "existing":
        return this.#glyphIds.has(candidate.glyphId);
      case "missing":
        return this.#codepoints.has(candidate.unicode);
    }
  }
}

function existingCandidate(glyph: GlyphCatalogItem): ComponentCandidate {
  return {
    availability: "existing",
    glyphId: glyph.id,
    name: glyph.name,
    displayName: glyph.displayName,
    unicode: glyph.unicode,
  };
}

function missingCandidate(info: GlyphInfoGlyph): ComponentCandidate {
  return {
    availability: "missing",
    glyphId: null,
    name: info.name as GlyphName,
    displayName: info.name,
    unicode: info.codepoint,
  };
}

function decompositionOf(owner: GlyphCatalogItem, glyphInfo: GlyphInfo): readonly number[] {
  const canonicalName = glyphInfo.resolveGlyphName(owner.name, owner.unicode);
  const baseName = canonicalName.split(".")[0] ?? canonicalName;
  const unicode = owner.unicode ?? glyphInfo.getGlyphByName(baseName)?.codepoint ?? null;

  return unicode === null ? [] : glyphInfo.getDecomposition(unicode);
}

function cycleProducingGlyphIds(
  records: readonly GlyphRecord[],
  ownerId: GlyphId,
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
  const pending = [ownerId];
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
