import { documentTest, expect, FONT_PATH } from "./fixtures/electronApp";
import { expectPanelSnapshot } from "./fixtures/snapshots";

const test = documentTest.extend({
  openFontPath: FONT_PATH,
});

test("read-only preview notice matches snapshot", async ({ electronApp, page }) => {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: /Load font/ }).click();
  const workspacePage = await workspaceWindow;
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  await expect.poll(() => workspacePage.evaluate(() => window.shiftSession?.mode)).toBe("preview");

  await workspacePage.getByRole("button", { name: "Read-only preview", exact: true }).click();
  const notice = workspacePage.getByRole("dialog", { name: "This font is view-only" });

  await expectPanelSnapshot(notice, "read-only-preview-notice.png");
});
