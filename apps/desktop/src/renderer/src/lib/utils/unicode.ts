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
 * Heuristic detection for non-spacing glyph refs used in editor-only visual layout.
 */
export function isLikelyNonSpacingGlyphRef(glyphName: string, unicode: number | null): boolean {
  if (isNonSpacingMarkCodepoint(unicode)) return true;
  return /(?:^|[._-])(comb|mark)(?:$|[._-])/i.test(glyphName);
}
