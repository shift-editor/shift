/**
 * Editor-only advance for a nonspacing mark whose authored advance is zero.
 * Without it, a mark would have no visible width on the canvas.
 */
export const NONSPACING_MARK_EDITOR_ADVANCE = 600;

/**
 * Returns the advance used for on-canvas layout (metric guides, text runs).
 *
 * @remarks
 * Matches the glyph's authored advance, except that a nonspacing mark at zero
 * gets {@link NONSPACING_MARK_EDITOR_ADVANCE} so it stays visible and editable.
 * Export is unaffected.
 *
 * @param advance - The glyph's authored horizontal advance.
 * @param nonspacingMark - Whether the font resolves the glyph as a nonspacing mark.
 */
export function displayAdvance(advance: number, nonspacingMark: boolean): number {
  if (advance > 0) return advance;
  if (!nonspacingMark) return advance;
  return NONSPACING_MARK_EDITOR_ADVANCE;
}
