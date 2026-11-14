import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { runCommand } from "./appHooks";

/** An Export dialog target, by the name its sidebar row shows. */
export type ExportTargetName = "Variable" | "Static" | "UFO";

/**
 * Exports through the Export dialog: opens it, picks `target`, takes the
 * folder the scripted chooser returns, and presses Export.
 *
 * @returns whether the dialog reported the export done or failed.
 */
export async function exportWithDialog(
  page: Page,
  target: ExportTargetName,
): Promise<"done" | "failed"> {
  await runCommand(page, "file.export");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: target, exact: true }).click();
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();

  const done = dialog.getByRole("status");
  const failed = dialog.getByRole("alert");
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
