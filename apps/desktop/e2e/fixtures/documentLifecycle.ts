import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { CommandId } from "../../src/shared/commands";
import { once } from "node:events";
import path from "node:path";
import { MAIN_JS, waitForWorkspaceReady } from "./electronApp";

export async function createNewFont(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: "New font", exact: true }).click();

  const workspacePage = await workspaceWindow;
  await waitForWorkspaceReady(workspacePage);
  return workspacePage;
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

export async function quitApp(electronApp: ElectronApplication): Promise<void> {
  const exited = once(electronApp.process(), "exit");
  await requestAppQuit(electronApp);
  await exited;
}

export async function relaunchApp(
  testRoot: string,
  saveShiftPath: string,
): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      MAIN_JS,
      `--user-data-dir=${path.join(testRoot, "user-data")}`,
      "--force-device-scale-factor=1",
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      LIBGL_ALWAYS_SOFTWARE: "1",
      SHIFT_E2E_NATIVE_DIALOGS: "1",
      SHIFT_E2E_OPEN_FONT_PATH: saveShiftPath,
      SHIFT_E2E_SAVE_SHIFT_PATH: saveShiftPath,
    },
  });
}

export async function killApp(electronApp: ElectronApplication): Promise<void> {
  const childProcess = electronApp.process();
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  childProcess.kill("SIGKILL");
  await exited;
}
