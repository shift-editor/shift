import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { editorCanvasStack } from "./appLocators";
import type { EditorDriver } from "./EditorDriver";

/**
 * Normalizes host-dependent decoration, such as native scrollbar gutters, in golden captures.
 * Use only for captures; keep interaction and visibility assertions on the unmodified layout.
 */
export const SCREENSHOT_STYLE_PATH = path.join(__dirname, "..", "editor.screenshot.css");

/**
 * Interface goldens compare exactly, but only on CI.
 *
 * @remarks
 * Text antialiasing differs between development Macs and the hosted runner, so interface
 * baselines come from the runner (the `ci: update visual snapshots` label) and are compared
 * only there. A per-pixel `threshold` above zero would hide real token changes: Playwright
 * ignores any pixel whose colour moved less than the threshold, even with `maxDiffPixels: 0`.
 */
const INTERFACE_SNAPSHOT_OPTIONS = {
  stylePath: SCREENSHOT_STYLE_PATH,
  animations: "disabled",
  caret: "hide",
  maxDiffPixels: 0,
  threshold: 0,
} as const;

/**
 * Canvas goldens compare exactly on every host: software canvas rendering is pixel-identical
 * locally and on CI, and thin or translucent strokes (handles, comparison outlines) change too
 * few pixels, too slightly, for any tolerance to be safe. `threshold: 0` matters as much as
 * `maxDiffPixels: 0`; the default per-pixel threshold accepts colour changes such as a
 * different outline token. Captures keep device pixels, so a HiDPI golden records
 * backing-store detail instead of a CSS-pixel downsample; at 1× the two scales are identical.
 */
const CANVAS_SNAPSHOT_OPTIONS = {
  animations: "disabled",
  caret: "hide",
  maxDiffPixels: 0,
  threshold: 0,
  scale: "device",
} as const;

/**
 * Reports whether interface goldens are compared in this run.
 *
 * @remarks
 * Locally the capture is attached for inspection instead, so nothing is compared against,
 * or written over, runner-generated baselines.
 *
 * @param name - golden about to be compared.
 * @param target - element or window that would be captured.
 * @returns true on CI.
 */
async function comparesInterfaceGoldens(name: string, target: Locator | Page): Promise<boolean> {
  if (process.env.CI) return true;

  test.info().annotations.push({
    type: "interface-golden",
    description: `${name} is compared on CI only; its baseline comes from the hosted runner.`,
  });
  await attachLocalCapture(name, target);
  return false;
}

async function attachLocalCapture(name: string, target: Locator | Page): Promise<void> {
  const body = await target.screenshot({ animations: "disabled", caret: "hide" });
  await test.info().attach(`local-${name}`, { body, contentType: "image/png" });
}

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
 * Asserts a panel or page region against a runner-generated golden with host decoration
 * normalized. Compared on CI only; see {@link INTERFACE_SNAPSHOT_OPTIONS}.
 *
 * @param target - smallest locator that owns the visual contract.
 * @param name - golden file name under the spec's snapshot directory.
 */
export async function expectPanelSnapshot(target: Locator, name: string): Promise<void> {
  refuseRetriedGolden(name);
  if (!(await comparesInterfaceGoldens(name, target))) return;

  await expect(target).toHaveScreenshot(name, INTERFACE_SNAPSHOT_OPTIONS);
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
  if (!(await comparesInterfaceGoldens(name, page))) return;

  await expect(page).toHaveScreenshot(name, INTERFACE_SNAPSHOT_OPTIONS);
}
