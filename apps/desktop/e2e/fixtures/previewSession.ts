import type { Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";

// What a preview session keeps in memory, for specs that check a preview stays light: it opens
// no authored workspace and loads no glyph models until one is opened. Agents never see these.

/** Whether the window publishes an authored workspace, and how many glyph models it has loaded. */
export async function previewLoadState(
  page: Page,
): Promise<{ authoredWorkspace: boolean; loadedGlyphCount: number }> {
  return page.evaluate(() => {
    const session = window.shiftSession;
    return {
      authoredWorkspace: window.shift !== undefined,
      loadedGlyphCount:
        session?.font.glyphEntries().filter((entry) => session.editor.glyphForId(entry.id) !== null)
          .length ?? -1,
    };
  });
}

/** Whether the preview font lists `glyphId`, has an authored record for it, and how many layers its model has. */
export async function previewGlyphState(
  page: Page,
  glyphId: GlyphId,
): Promise<{ hasEntry: boolean; hasAuthoredRecord: boolean; layerCount: number }> {
  return page.evaluate((id) => {
    const session = window.shiftSession;
    if (!session) throw new Error("Expected preview font session");

    return {
      hasEntry: session.font.entryForId(id) !== null,
      hasAuthoredRecord: session.font.recordForId(id) !== null,
      layerCount: session.editor.glyphForId(id)?.layers.length ?? -1,
    };
  }, glyphId);
}

/**
 * Makes every later glyph acquisition in the window's font session reject, so a step that would
 * load or rebuild a glyph model fails instead of quietly reading the source again.
 */
export async function rejectGlyphAcquisition(page: Page): Promise<void> {
  await page.evaluate(() => {
    const font = window.shiftSession?.font;
    if (!font) throw new Error("Expected preview font");

    font.loadGlyph = async () => {
      throw new Error("variation scrub attempted glyph acquisition");
    };
    font.loadGlyphs = async () => {
      throw new Error("variation scrub attempted glyph acquisition");
    };
  });
}
