import { test, expect } from "./fixtures/electronApp";
import { expectPageSnapshot } from "./fixtures/snapshots";
import { glyphSearch } from "./fixtures/appLocators";

test.describe("Landing view", () => {
  test("matches default snapshot", { tag: "@golden" }, async ({ page }) => {
    // Wait for React to mount the landing view.
    await page.waitForSelector("text=Shift", { timeout: 10_000 });

    await expectPageSnapshot(page, "landing-default.png");
  });

  test("the help button runs a Help menu command", async ({ electronApp, page }) => {
    const feedbackOpened = electronApp.waitForEvent("window");

    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("menuitem", { name: "Feedback…", exact: true }).click();

    const feedbackPage = await feedbackOpened;
    await feedbackPage.waitForURL(/#\/feedback$/);
    await expect(feedbackPage.getByRole("heading", { name: "Feedback" })).toBeVisible();
  });

  test("creates an editable font through New font", async ({ electronApp, page }) => {
    const workspaceWindow = electronApp.waitForEvent("window");

    await page.getByRole("button", { name: "New font", exact: true }).click();

    const workspacePage = await workspaceWindow;
    await workspacePage.waitForURL(/#\/home$/);
    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await (await glyphSearch(workspacePage)).fill("newGlyph");
    await expect(
      workspacePage.getByRole("region", { name: "Glyph catalog surface", exact: true }),
    ).toHaveAttribute("data-filtered-glyph-count", "1");
  });
});
