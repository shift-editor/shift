import type { ElectronApplication, Page } from "@playwright/test";
import { documentTest, expect, FONT_PATH } from "./fixtures/electronApp";

const test = documentTest.extend({
  openFontPath: FONT_PATH,
});

const FONT_NAME = "MutatorSans.ttf";

async function openFontFromLauncher(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: "Open Font…", exact: true }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  return workspacePage;
}

function recentFile(launcher: Page) {
  return launcher
    .getByRole("list", { name: "Recent files" })
    .getByRole("listitem")
    .filter({ hasText: FONT_NAME });
}

test("a font opened once is listed in Recent files after relaunch and reopens from its card", async ({
  electronApp,
  page,
  relaunch,
}) => {
  await openFontFromLauncher(page, electronApp);
  await electronApp.close();

  const restarted = await relaunch();
  const launcher = await restarted.firstWindow();
  await launcher.waitForURL(/#\/launcher$/);
  await expect(recentFile(launcher)).toHaveCount(1);
  // MutatorSans has capitals only, so its thumbnail specimen is "AG".
  await expect(recentFile(launcher)).toHaveAttribute("data-specimen-text", "AG");

  const workspaceWindow = restarted.waitForEvent("window");
  await recentFile(launcher)
    .getByRole("button", { name: new RegExp(FONT_NAME) })
    .click();
  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect.poll(() => workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");
});

test("removing a recent file can be undone from the toast", async ({
  electronApp,
  page,
  relaunch,
}) => {
  await openFontFromLauncher(page, electronApp);
  await electronApp.close();

  const restarted = await relaunch();
  const launcher = await restarted.firstWindow();
  await expect(recentFile(launcher)).toHaveCount(1);

  await recentFile(launcher).getByRole("button", { name: "More actions" }).click();
  await launcher.getByRole("menuitem", { name: "Remove from Recents" }).click();
  await expect(recentFile(launcher)).toHaveCount(0);

  await launcher.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(recentFile(launcher)).toHaveCount(1);
});

test("File › Open Recent lists opened fonts and clears them", async ({ electronApp, page }) => {
  await openFontFromLauncher(page, electronApp);

  const openRecentLabels = () =>
    electronApp.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
      const openRecent = file?.submenu?.items.find((item) => item.label === "Open Recent");
      return openRecent?.submenu?.items.map((item) => item.label) ?? null;
    });

  await expect.poll(openRecentLabels).toEqual([FONT_NAME, "", "Clear Menu"]);

  await electronApp.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
    const openRecent = file?.submenu?.items.find((item) => item.label === "Open Recent");
    const clear = openRecent?.submenu?.items.find((item) => item.label === "Clear Menu");
    if (!clear) throw new Error("Missing Clear Menu item");
    clear.click();
  });

  await expect.poll(openRecentLabels).toEqual(["Clear Menu"]);
});
