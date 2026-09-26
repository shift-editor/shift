import path from "node:path";
import { expect, type Locator } from "@playwright/test";
import { editorCanvasStack } from "./appLocators";
import type { EditorDriver } from "./EditorDriver";

/**
 * Normalizes host-dependent decoration, such as native scrollbar gutters, in golden captures.
 * Use only for captures; keep interaction and visibility assertions on the unmodified layout.
 */
export const SCREENSHOT_STYLE_PATH = path.join(__dirname, "..", "editor.screenshot.css");

/** Options for page and panel goldens whose layout includes the editor sidebars. */
export const PAGE_SNAPSHOT_OPTIONS = {
  stylePath: SCREENSHOT_STYLE_PATH,
  animations: "disabled",
  caret: "hide",
} as const;

/**
 * Canvas goldens compare exactly: thin strokes and handles occupy few pixels, so a ratio
 * tolerance could accept a displaced curve or a missing marker.
 */
const CANVAS_SNAPSHOT_OPTIONS = {
  animations: "disabled",
  caret: "hide",
  maxDiffPixels: 0,
} as const;

/**
 * Asserts the composited editor canvas against a golden once the latest edits have rendered.
 *
 * @remarks
 * `toHaveScreenshot` also waits for two consecutive identical captures before comparing.
 * The pointer is not moved: hover and preview state belong to the caller's scenario.
 *
 * @param editor - driver for the editor whose canvas stack is captured.
 * @param name - golden file name under the spec's snapshot directory.
 */
export async function expectCanvasSnapshot(editor: EditorDriver, name: string): Promise<void> {
  await editor.waitForCanvasRender();
  await expect(editorCanvasStack(editor.page)).toHaveScreenshot(name, CANVAS_SNAPSHOT_OPTIONS);
}

/**
 * Asserts a panel or page region against a golden with host decoration normalized.
 *
 * @param target - smallest locator that owns the visual contract.
 * @param name - golden file name under the spec's snapshot directory.
 */
export async function expectPanelSnapshot(target: Locator, name: string): Promise<void> {
  await expect(target).toHaveScreenshot(name, PAGE_SNAPSHOT_OPTIONS);
}
