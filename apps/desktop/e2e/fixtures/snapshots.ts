import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { editorCanvasStack } from "./appLocators";
import type { EditorDriver } from "./EditorDriver";

/**
 * Normalizes host-dependent decoration, such as native scrollbar gutters, in golden captures.
 * Use only for captures; keep interaction and visibility assertions on the unmodified layout.
 */
export const SCREENSHOT_STYLE_PATH = path.join(__dirname, "..", "editor.screenshot.css");

/** Options for page and panel goldens whose layout includes the editor sidebars. */
const PAGE_SNAPSHOT_OPTIONS = {
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
 * Refuses to compare a golden on a retry attempt.
 *
 * @remarks
 * CI retries once so ordinary failures collect a second trace. A golden that fails first and
 * matches on retry is nondeterministic and must be explained, so any test that asserts a
 * golden fails on its retry instead of passing. Every golden goes through this module; the
 * E2E project check rejects `toHaveScreenshot` calls elsewhere.
 *
 * @param name - golden about to be compared.
 * @throws {Error} on every retry attempt.
 */
function refuseRetriedGolden(name: string): void {
  const { retry } = test.info();
  if (retry === 0) return;

  throw new Error(
    `Golden ${name} is not compared on retry ${retry}; investigate the first attempt instead.`,
  );
}

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
  refuseRetriedGolden(name);
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
  refuseRetriedGolden(name);
  await expect(target).toHaveScreenshot(name, PAGE_SNAPSHOT_OPTIONS);
}

/**
 * Asserts a whole window against a golden with host decoration normalized.
 *
 * @remarks
 * Prefer {@link expectPanelSnapshot} or {@link expectCanvasSnapshot}; a full-window golden
 * breaks on any chrome change and should protect overall composition only.
 *
 * @param page - window whose viewport is captured.
 * @param name - golden file name under the spec's snapshot directory.
 */
export async function expectPageSnapshot(page: Page, name: string): Promise<void> {
  refuseRetriedGolden(name);
  await expect(page).toHaveScreenshot(name, PAGE_SNAPSHOT_OPTIONS);
}
