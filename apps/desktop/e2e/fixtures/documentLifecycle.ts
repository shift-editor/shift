import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import type {} from "../../src/main/dialogs/NativeDialogs";
import type { CommandId } from "../../src/shared/commands";
import type { GlyphId } from "@shift/types";
import type { FontSummary } from "@/testing/reads";
import type { PreloadLayerRead } from "@/testing/e2e/SessionHooks";
import { execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { promisify } from "node:util";
import { hooksOf } from "./appHooks";
import { EditorDriver } from "./EditorDriver";
import { MAIN_JS, shiftTestEnvironment, waitForWorkspaceReady } from "./electronApp";

const execFileAsync = promisify(execFile);

export async function createNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: "New Font", exact: true }).click();

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

/** The mode of the font session in `page`'s window (`workspace`, `preview`, …), as agents read it. */
export async function sessionMode(
  page: Page,
  electronApp: ElectronApplication,
): Promise<FontSummary["mode"]> {
  return (await new EditorDriver(page, electronApp).fontOverview()).mode;
}

/**
 * Launches a second instance of the running app's executable with `documentPath`, as a file
 * manager does, and waits for it to hand the path to the first instance and exit.
 */
export async function launchSecondInstance(
  electronApp: ElectronApplication,
  testRoot: string,
  documentPath: string,
): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  const executablePath = await electronApp.evaluate(() => process.execPath);
  // A second instance that wins the single-instance lock never exits; bound the wait
  // so the test fails with the launch instead of the overall timeout.
  await execFileAsync(
    executablePath,
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      MAIN_JS,
      `--user-data-dir=${path.join(testRoot, "user-data")}`,
      documentPath,
    ],
    { env: shiftTestEnvironment(), timeout: 15_000 },
  );
}

/** Creates the glyph named `name` in one transaction, so one undo removes it. */
export async function createGlyphNamed(page: Page, name: string): Promise<void> {
  await hooksOf(page).session.createGlyphInOneStep(name);
}

/** Waits for a named glyph in the page's authored workspace and returns its identity. */
export async function glyphIdForName(page: Page, name: string): Promise<GlyphId> {
  const editor = new EditorDriver(page);
  await expect.poll(async () => (await editor.glyphNamed(name)) !== null).toBe(true);
  const glyph = await editor.glyphNamed(name);
  if (!glyph) throw new Error(`Expected ${name} glyph`);
  return glyph.id;
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

  await runWindowCommand(page, command);
}

/** Runs `command` in `page`'s window as its menu item does, without focusing the window first. */
export async function runWindowCommand(page: Page, command: CommandId): Promise<void> {
  await hooksOf(page).session.runCommand(command);
}

/** What the native application menu holds: its top-level menus, roles and chosen items. */
export interface ApplicationMenuSummary {
  packaged: boolean;
  platform: NodeJS.Platform;
  topLevelLabels: string[];
  topLevelRoles: (string | undefined)[];
  /** Every submenu item's role, lowercased. */
  roles: (string | undefined)[];
  viewLabels: string[];
  fileIds: string[];
  editIds: string[];
  glyphIds: string[];
  settingsInstalled: boolean;
  addComponentAccelerator: string | null | undefined;
}

/** Reads the native application menu main installed. */
export async function applicationMenuSummary(
  electronApp: ElectronApplication,
): Promise<ApplicationMenuSummary> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  return electronApp.evaluate(({ app, Menu }) => {
    const items = Menu.getApplicationMenu()?.items ?? [];
    const submenuIds = (label: string) =>
      items.find((item) => item.label === label)?.submenu?.items.map((item) => item.id) ?? [];

    return {
      packaged: app.isPackaged,
      platform: process.platform,
      topLevelLabels: items.map((item) => item.label),
      topLevelRoles: items.map((item) => item.role?.toLowerCase()),
      roles: items.flatMap(
        (item) =>
          item.submenu?.items.map((child) => child.role?.toLowerCase()).filter(Boolean) ?? [],
      ),
      viewLabels:
        items.find((item) => item.label === "View")?.submenu?.items.map((item) => item.label) ?? [],
      fileIds: submenuIds("File"),
      editIds: submenuIds("Edit"),
      glyphIds: submenuIds("Glyph"),
      settingsInstalled: Menu.getApplicationMenu()?.getMenuItemById("app.showSettings") !== null,
      addComponentAccelerator:
        Menu.getApplicationMenu()?.getMenuItemById("glyph.addComponent")?.accelerator,
    };
  });
}

/** The labels under File › Open Recent in the native menu, or null when it has no such menu. */
export async function openRecentLabels(electronApp: ElectronApplication): Promise<string[] | null> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  return electronApp.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
    const openRecent = file?.submenu?.items.find((item) => item.label === "Open Recent");
    return openRecent?.submenu?.items.map((item) => item.label) ?? null;
  });
}

/** Clicks the File › Open Recent item labelled `label` in the native menu. */
export async function clickOpenRecentItem(
  electronApp: ElectronApplication,
  label: string,
): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  await electronApp.evaluate(({ Menu }, itemLabel) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
    const openRecent = file?.submenu?.items.find((item) => item.label === "Open Recent");
    const item = openRecent?.submenu?.items.find((candidate) => candidate.label === itemLabel);
    if (!item) throw new Error(`Missing Open Recent item ${itemLabel}`);
    item.click();
  }, label);
}

/** The system clipboard's text, read in main. */
export async function clipboardText(electronApp: ElectronApplication): Promise<string> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  return electronApp.evaluate(({ clipboard }) => clipboard.readText());
}

/** Puts `text` on the system clipboard from main, as another app would. */
export async function writeClipboardText(
  electronApp: ElectronApplication,
  text: string,
): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  await electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

export async function applicationMenuItemEnabled(
  page: Page,
  electronApp: ElectronApplication,
  command: CommandId,
): Promise<boolean> {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) => window.focus());
  await browserWindow.dispose();

  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
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

  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
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
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  await electronApp.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
}

/** Asks the app to quit and waits until main has started quitting (`before-quit`). */
export async function startAppQuit(electronApp: ElectronApplication): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  await electronApp.evaluate(
    ({ app }) =>
      new Promise<void>((resolve) => {
        app.once("before-quit", () => resolve());
        app.quit();
      }),
  );
}

/**
 * Saves `page`'s document to `savePath`, as Save As does once its dialog returns a path;
 * for tests that run without scripted dialogs.
 */
export async function saveDocumentAs(page: Page, savePath: string): Promise<void> {
  await hooksOf(page).session.saveDocumentAs(savePath);
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
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
  return electronApp.evaluate(() => globalThis.shiftScriptedDialogs?.dirtyDocumentDecisions ?? []);
}

/** Returns how many dirty-document confirmations scripted dialogs have started. */
export async function dirtyDocumentRequests(electronApp: ElectronApplication): Promise<number> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- reads or drives Electron main (menu, clipboard, app lifecycle, scripted dialogs), not the renderer
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

/**
 * Reads the first glyph that has a layer through the preload's layer store API, as the window
 * reads the open document: the store's kind, that layer's id, its decoded bytes, the component
 * closure of the glyph, and the glyph's id.
 */
export async function readFirstLayerThroughPreload(page: Page): Promise<PreloadLayerRead> {
  return hooksOf(page).session.firstLayerThroughPreload();
}

/** Clicks the launcher's Open Font… (with a scripted dialog) and returns the workspace window once its Grid shows. */
export async function openFontFromLauncher(
  launcher: Page,
  electronApp: ElectronApplication,
): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await launcher.getByRole("button", { name: "Open Font…", exact: true }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  return workspacePage;
}
