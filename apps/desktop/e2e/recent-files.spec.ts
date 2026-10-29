import type { Page } from "@playwright/test";
import { documentTest, expect, FONTS } from "./fixtures/electronApp";
import {
  clickOpenRecentItem,
  openFontFromLauncher,
  openRecentLabels,
  sessionMode,
} from "./fixtures/documentLifecycle";

const test = documentTest.extend({
  openFontPath: FONTS.mutatorSansTtf,
});

const FONT_NAME = "MutatorSans.ttf";

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
  await expect.poll(() => sessionMode(workspacePage, restarted)).toBe("preview");
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

test(
  "File › Open Recent lists opened fonts and clears them",
  { tag: "@os" },
  async ({ electronApp, page }) => {
    await openFontFromLauncher(page, electronApp);

    await expect.poll(() => openRecentLabels(electronApp)).toEqual([FONT_NAME, "", "Clear Menu"]);

    await clickOpenRecentItem(electronApp, "Clear Menu");

    await expect.poll(() => openRecentLabels(electronApp)).toEqual(["Clear Menu"]);
  },
);
