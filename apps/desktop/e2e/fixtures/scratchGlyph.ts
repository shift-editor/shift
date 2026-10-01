import type { Page } from "@playwright/test";
import type { GlyphName } from "@shift/types";
import type { EditorDriver } from "./EditorDriver";
import type { ScratchContour } from "./types";

/**
 * Creates an empty glyph, opens it, and optionally inserts contours framed in the viewport.
 *
 * @remarks
 * Setup for gesture tests whose subject is not drawing. Returns after the inserted
 * geometry is persisted, the selection is empty, and the fitted camera has rendered.
 *
 * @param page - authored workspace window.
 * @param editor - driver for the same window.
 * @param name - unique glyph name for the test.
 * @param contours - geometry to insert; omit for an empty glyph at the default camera.
 */
export async function openScratchGlyph(
  page: Page,
  editor: EditorDriver,
  name: string,
  contours: readonly ScratchContour[] = [],
): Promise<void> {
  const glyphId = await page.evaluate(async (glyphName) => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected authored workspace");

    const record = workspace.editor.createGlyph(glyphName as GlyphName);
    await workspace.font.editCoordinator.settled();
    return record.id;
  }, name);
  await editor.openGlyph(glyphId);

  if (contours.length > 0) {
    await page.evaluate(async (content) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected authored workspace");

      const inserted = workspace.editor.insertContent({
        contours: content.map((contour) => ({ ...contour, points: [...contour.points] })),
      });
      if (!inserted) throw new Error("Expected inserted scratch contours");

      await workspace.font.editCoordinator.settled();
      workspace.editor.selection.clear();
      workspace.editor.zoomToFit();
    }, contours);
  }

  await editor.waitForCanvasRender();
}
