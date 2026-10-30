import type { Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { hooksOf } from "./appHooks";

// What a preview session keeps in memory, for specs that check a preview stays light: it opens
// no authored workspace and loads no glyph models until one is opened. Agents never see these.

/** Whether the window publishes an authored workspace, and how many glyph models it has loaded. */
export async function previewLoadState(
  page: Page,
): Promise<{ authoredWorkspace: boolean; loadedGlyphCount: number }> {
  return hooksOf(page).session.previewLoadState();
}

/** Whether the preview font lists `glyphId`, has an authored record for it, and how many layers its model has. */
export async function previewGlyphState(
  page: Page,
  glyphId: GlyphId,
): Promise<{ hasEntry: boolean; hasAuthoredRecord: boolean; layerCount: number }> {
  return hooksOf(page).session.previewGlyphState(glyphId);
}

/**
 * Makes every later glyph acquisition in the window's font session reject, so a step that would
 * load or rebuild a glyph model fails instead of quietly reading the source again.
 */
export async function rejectGlyphAcquisition(page: Page): Promise<void> {
  await hooksOf(page).session.rejectGlyphAcquisition();
}
