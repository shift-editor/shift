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

/**
 * Parses a codepoint typed as hex, with or without a `U+` or `0x` prefix.
 *
 * @returns null when the text is not a Unicode scalar value: out of range,
 * a surrogate, or not hex.
 */
export function parseCodepoint(text: string): number | null {
  const hex = text.trim().replace(/^(u\+|0x)/i, "");
  if (!/^[0-9a-f]{1,6}$/i.test(hex)) return null;

  const codepoint = Number.parseInt(hex, 16);
  const surrogate = codepoint >= 0xd800 && codepoint <= 0xdfff;
  return codepoint > 0x10ffff || surrogate ? null : codepoint;
}
