import { documentTest, expect, FONT_PATH } from "./fixtures/electronApp";
import { expectPanelSnapshot } from "./fixtures/snapshots";
import { prepareWindow } from "./fixtures/window";

const test = documentTest.extend({
  openFontPath: FONT_PATH,
});

test(
  "read-only preview notice matches snapshot",
  { tag: "@golden" },
  async ({ electronApp, page }) => {
    const workspaceWindow = electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "Open Font…", exact: true }).click();
    const workspacePage = await workspaceWindow;
    // The workspace opens in a second window that macOS places and sizes itself. The notice is
    // centred in it, so give it the fixed visual size before capturing.
    await prepareWindow(electronApp, workspacePage, "visual");
    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession?.mode))
      .toBe("preview");

    await workspacePage.getByRole("button", { name: "Read-only preview", exact: true }).click();
    const notice = workspacePage.getByRole("dialog", { name: "This font is view-only" });
    await expect(notice).toBeVisible();
    await workspacePage.mouse.move(0, 0);

    await expectPanelSnapshot(notice, "read-only-preview-notice.png");
  },
);
