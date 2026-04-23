import type { GlyphRef } from "@/lib/tools/text/layout";

/**
 * Convert a Unicode codepoint to its hex representation without prefix (e.g. for URLs).
 */
export function codepointToHex(codepoint: number): string {
  return codepoint.toString(16).padStart(4, "0").toUpperCase();
}

/**
 * Format a Unicode codepoint as U+XXXX (e.g. for display).
 */
export function formatCodepointAsUPlus(codepoint: number): string {
  return `U+${codepointToHex(codepoint)}`;
}

export function fallbackGlyphNameForUnicode(unicode: number): string {
  return `uni${codepointToHex(unicode)}`;
}

export interface GlyphNameResolverDeps {
  getExistingGlyphNameForUnicode(unicode: number): string | null;
  getMappedGlyphName(unicode: number): string | null;
}

export function resolveGlyphNameFromUnicode(unicode: number, deps: GlyphNameResolverDeps): string {
  const existingName = deps.getExistingGlyphNameForUnicode(unicode);
  if (existingName) {
    return existingName;
  }

  const mappedName = deps.getMappedGlyphName(unicode);
  if (mappedName) {
    return mappedName;
  }

  return fallbackGlyphNameForUnicode(unicode);
}

export function glyphRefFromUnicode(unicode: number, deps: GlyphNameResolverDeps): GlyphRef {
  return {
    glyphName: resolveGlyphNameFromUnicode(unicode, deps),
    unicode,
  };
}

const nonSpacingCache = new Map<number, boolean>();

/**
 * Returns true when the codepoint is a non-spacing mark (Unicode Mn/Me).
 */
export function isNonSpacingMarkCodepoint(codepoint: number | null): boolean {
  if (codepoint === null || !Number.isFinite(codepoint) || codepoint < 0) {
    return false;
  }

  const cached = nonSpacingCache.get(codepoint);
  if (cached !== undefined) {
    return cached;
  }

  let result = false;
  try {
    const char = String.fromCodePoint(codepoint);
    result = /\p{Mn}|\p{Me}/u.test(char);
  } catch {
    result = false;
  }

  nonSpacingCache.set(codepoint, result);
  return result;
}

/**
 * Heuristic check for non-spacing glyphs (combining marks) — combines the
 * Unicode Mn/Me categories with a glyph-name token match (`comb` / `mark`).
 * Used in editor-only visual layout to give combining glyphs a visible advance.
 */
export function isNonSpacingGlyph(glyphName: string, unicode: number | null): boolean {
  if (isNonSpacingMarkCodepoint(unicode)) return true;
  return /(?:^|[._-])(comb|mark)(?:$|[._-])/i.test(glyphName);
}

/**
 * Editor-only advance used when a non-spacing glyph reports zero xAdvance —
 * without this, combining marks would render with no visible width.
 */
export const NON_SPACING_EDITOR_ADVANCE = 600;

/**
 * Advance used for on-canvas layout (guides, text runs). Matches the glyph's
 * xAdvance except for non-spacing glyphs at zero, which get a visible fallback.
 */
export function displayAdvance(advance: number, glyphName: string, unicode: number | null): number {
  if (advance > 0) return advance;
  if (!isNonSpacingGlyph(glyphName, unicode)) return advance;
  return NON_SPACING_EDITOR_ADVANCE;
}
