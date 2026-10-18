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
