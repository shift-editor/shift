import type { Page } from "@playwright/test";
import type { PositionGuide } from "@shift/editor/types";

/**
 * Returns the snap guides the active Select or Pen gesture publishes for its overlay.
 *
 * @param page - authored workspace window with an active glyph editor.
 * @returns Guides drawn by the gesture overlay; empty when no guided gesture is active.
 */
export async function activeSnapGuides(page: Page): Promise<readonly PositionGuide[]> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    if (!editor) throw new Error("Expected editor");

    const select = editor.toolIf("select")?.state;
    if (select?.type === "translating") return select.translate.guides;

    const pen = editor.toolIf("pen")?.state;
    if (pen?.type === "dragging") return pen.guides;

    return [];
  });
}
