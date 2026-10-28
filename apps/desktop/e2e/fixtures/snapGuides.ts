import type { Page } from "@playwright/test";
import type { PositionGuide } from "@shift/editor/types";
import { callHook } from "./appHooks";

/**
 * Returns the snap guides the active Select or Pen gesture publishes for its overlay.
 *
 * @param page - authored workspace window with an active glyph editor.
 * @returns Guides drawn by the gesture overlay; empty when no guided gesture is active.
 */
export async function activeSnapGuides(page: Page): Promise<readonly PositionGuide[]> {
  return callHook(page, "interactions", "activeSnapGuides");
}
