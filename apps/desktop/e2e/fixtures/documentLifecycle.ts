import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import type {} from "../../src/main/dialogs/NativeDialogs";
import type { CommandId } from "../../src/shared/commands";
import type { GlyphId } from "@shift/types";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { waitForWorkspaceReady } from "./electronApp";

export async function createNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: "New font", exact: true }).click();

  const workspacePage = await workspaceWindow;
  await waitForWorkspaceReady(workspacePage);
  return workspacePage;
}

/** Opens a new untitled font window and dirties it with one created glyph. */
export async function dirtyNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspacePage = await createNewFont(page, electronApp);
  await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
  await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  return workspacePage;
}

/** Opens another untitled font through File > New and dirties it with one created glyph. */
export async function createAnotherDirtyFont(
  page: Page,
  electronApp: ElectronApplication,
): Promise<Page> {
  const nextWindow = electronApp.waitForEvent("window");
  await runCommand(page, electronApp, "file.new");
  const nextPage = await nextWindow;
  await waitForWorkspaceReady(nextPage);
  await nextPage.getByRole("button", { name: "Create glyph", exact: true }).click();
  await expect.poll(() => windowTitle(nextPage, electronApp)).toContain("Untitled *");
  return nextPage;
}

/** Waits for a named glyph in the page's authored workspace and returns its identity. */
export async function glyphIdForName(page: Page, name: string): Promise<GlyphId> {
  await expect
    .poll(() =>
      page.evaluate(
        (glyphName) => window.shift?.font.glyphRecords().some(({ name }) => name === glyphName),
        name,
      ),
    )
    .toBe(true);
  const glyphId = await page.evaluate(
    (glyphName) => window.shift?.font.glyphRecords().find(({ name }) => name === glyphName)?.id,
    name,
  );
  if (!glyphId) throw new Error(`Expected ${name} glyph`);
  return glyphId;
}

export async function runCommand(
  page: Page,
  electronApp: ElectronApplication,
  command: CommandId,
): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await expect
    .poll(() =>
      browserWindow.evaluate((window) => {
        window.focus();
        return window.isFocused();
      }),
    )
    .toBe(true);
  await browserWindow.dispose();

  await page.evaluate(async (id) => {
    const host = window.shiftHost;
    if (!host) throw new Error("Expected Shift host");

    await host.commands.run(id);
  }, command);
}

export async function applicationMenuItemEnabled(
  page: Page,
  electronApp: ElectronApplication,
  command: CommandId,
): Promise<boolean> {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) => window.focus());
  await browserWindow.dispose();

  return electronApp.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error(`Missing application menu item: ${id}`);
    return item.enabled;
  }, command);
}

export async function clickApplicationMenuItem(
  page: Page,
  electronApp: ElectronApplication,
  command: CommandId,
): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await expect
    .poll(() =>
      browserWindow.evaluate((window) => {
        window.focus();
        return window.isFocused();
      }),
    )
    .toBe(true);
  await browserWindow.dispose();

  await electronApp.evaluate(({ BrowserWindow, Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error(`Missing application menu item: ${id}`);
    if (!item.enabled) throw new Error(`Application menu item is disabled: ${id}`);
    item.click(item, BrowserWindow.getFocusedWindow(), {});
  }, command);
}

export async function windowTitle(page: Page, electronApp: ElectronApplication): Promise<string> {
  const browserWindow = await electronApp.browserWindow(page);
  const title = await browserWindow.evaluate((window) => window.getTitle());
  await browserWindow.dispose();
  return title;
}

export async function closeWindow(page: Page, electronApp: ElectronApplication): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) => window.close());
  await browserWindow.dispose();
}

export async function requestAppQuit(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
}

/**
 * Returns the dirty-document decisions scripted dialogs have answered so far.
 *
 * @remarks
 * Each read is a main-process round trip, so close and quit guards have finished reacting
 * to an answered decision before the next read returns.
 */
export async function dirtyDocumentDecisions(
  electronApp: ElectronApplication,
): Promise<readonly DirtyDocumentChoice[]> {
  return electronApp.evaluate(() => globalThis.shiftScriptedDialogs?.dirtyDocumentDecisions ?? []);
}

/** Returns how many dirty-document confirmations scripted dialogs have started. */
export async function dirtyDocumentRequests(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(() => globalThis.shiftScriptedDialogs?.dirtyDocumentRequests ?? 0);
}

/**
 * Ensures the Electron process exits after a quit request or last-window shutdown.
 *
 * @param electronApp - application to quit if its process is still running.
 * @param childProcess - process retained before closing the last window or requesting quit;
 *   defaults to the application's process only while its Playwright connection is live.
 */
export async function quitApp(
  electronApp: ElectronApplication,
  childProcess: ChildProcess = electronApp.process(),
): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  try {
    await requestAppQuit(electronApp);
  } catch {
    if (childProcess.exitCode === null && childProcess.signalCode === null) await exited;
    return;
  }
  await exited;
}
