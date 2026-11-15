import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** The left sidebar's Export section. */
export function exportSection(page: Page): Locator {
  return page.getByRole("region", { name: "Export", exact: true });
}

/**
 * Opens the first Export row's options and chooses its folder; the scripted
 * chooser answers with `SHIFT_E2E_EXPORT_DIRECTORY`.
 */
export async function chooseExportFolder(page: Page): Promise<void> {
  await exportSection(page).getByRole("button", { name: "Export options" }).first().click();
  const options = page.getByRole("dialog");
  await options.getByRole("button", { name: "Choose…" }).click();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
}

/**
 * Exports the first Export row, a variable TrueType by default, into the
 * scripted folder, and presses Export.
 *
 * @returns whether the section reported the export done or failed.
 */
export async function exportFromSidebar(page: Page): Promise<"done" | "failed"> {
  await chooseExportFolder(page);
  const section = exportSection(page);
  await section
    .getByRole("button", { name: /^Export/ })
    .last()
    .click();

  const done = section.getByText("Exported · Show in Finder");
  const failed = section.getByRole("alert");
  await expect(done.or(failed)).toBeVisible();
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
