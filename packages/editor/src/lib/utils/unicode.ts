import type { GlyphTextItem } from "../text/layout/types";
import { glyphTextItem } from "../text/layout/types";

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

export function textItemFromCodepoint(
  codepoint: number,
  deps: GlyphNameResolverDeps,
): GlyphTextItem {
  return glyphTextItem(resolveGlyphNameFromUnicode(codepoint, deps), codepoint);
}
