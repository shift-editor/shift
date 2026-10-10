import type { GlyphEntry, GlyphId, KerningGroupId } from "@shift/types";

/** How many glyphs a search or suggestion lists; large fonts have tens of thousands. */
const ADD_MEMBER_LIMIT = 50;

/**
 * The glyphs to offer for adding to a group: those outside it matching
 * `query` by name or character, or with no query, the suggested ones.
 *
 * @param groupOf - The group a glyph is in at the group's position, if any.
 */
export function memberCandidates(
  entries: readonly GlyphEntry[],
  members: readonly GlyphId[],
  memberNames: readonly string[],
  query: string,
  groupOf: (entry: GlyphEntry) => KerningGroupId | null,
): GlyphEntry[] {
  const inGroup = new Set(members);
  const outside = entries.filter((entry) => !inGroup.has(entry.id));
  const typed = query.trim();
  if (!typed) return suggestedMembers(outside, memberStem(memberNames), groupOf);

  const lower = typed.toLowerCase();
  return outside
    .filter((entry) => entry.name.toLowerCase().includes(lower) || glyphCharacter(entry) === typed)
    .slice(0, ADD_MEMBER_LIMIT);
}

/**
 * The name the members share before any suffix, from the shortest:
 * `T` for T, T.ss01 and Tcaron.
 */
export function memberStem(memberNames: readonly string[]): string | null {
  let stem: string | null = null;
  for (const name of memberNames) {
    const base = name.split(".")[0] ?? "";
    if (base && (stem === null || base.length < stem.length)) stem = base;
  }
  return stem;
}

/**
 * Glyphs likely to belong with the members: those named after the shared
 * stem, the ones in no group at this position first.
 */
function suggestedMembers(
  outside: readonly GlyphEntry[],
  stem: string | null,
  groupOf: (entry: GlyphEntry) => KerningGroupId | null,
): GlyphEntry[] {
  if (!stem) return [];
  const named = outside.filter((entry) => entry.name.startsWith(stem));
  const ungrouped = named.filter((entry) => groupOf(entry) === null);
  const grouped = named.filter((entry) => groupOf(entry) !== null);
  return [...ungrouped, ...grouped].slice(0, ADD_MEMBER_LIMIT);
}

/** The glyph's first character, or an empty string for an unencoded glyph. */
function glyphCharacter(entry: GlyphEntry): string {
  const unicode = entry.unicodes[0];
  return unicode === undefined ? "" : String.fromCodePoint(unicode);
}
