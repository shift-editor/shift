import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** The Export section: the editor's right sidebar, or Home's sidebar. */
export function exportSection(page: Page): Locator {
  return page.getByRole("region", { name: "Export", exact: true });
}

/** Waits for the Export section, which the editor's right sidebar and Home always show. */
export async function showExportSection(page: Page): Promise<void> {
  await expect(exportSection(page)).toBeVisible();
}

/**
 * Opens the first Export row's options and chooses its folder; the scripted
 * chooser answers with `SHIFT_E2E_EXPORT_DIRECTORY`.
 */
export async function chooseExportFolder(page: Page): Promise<void> {
  await showExportSection(page);
  await exportSection(page).getByRole("button", { name: "Export options" }).first().click();
  const options = page.getByRole("dialog");
  await options.getByRole("button", { name: "Export folder" }).click();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
}

/**
 * Exports the first Export row, a variable TrueType by default, into the
 * scripted folder: presses Export, then Export in the popover it opens.
 *
 * @returns whether the popover reported the export done or failed.
 */
export async function exportFromSidebar(page: Page): Promise<"done" | "failed"> {
  await chooseExportFolder(page);
  await exportSection(page)
    .getByRole("button", { name: /^Export/ })
    .last()
    .click();
  const popover = page.getByRole("dialog");
  await popover.getByRole("button", { name: /^Export/ }).click();

  const done = popover.getByRole("button", { name: "Show in Finder" });
  const failed = popover.getByRole("alert");
  await expect(done.or(failed).first()).toBeVisible();
  return (await failed.count()) > 0 ? "failed" : "done";
}

/** The files with `extension` directly inside `directory`, as full paths. */
export function exportedFiles(directory: string, extension: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => path.join(directory, name));
}
