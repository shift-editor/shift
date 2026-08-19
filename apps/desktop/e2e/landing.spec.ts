import { test, expect } from "./fixtures/electronApp";

test.describe("Landing view", () => {
  test("matches default snapshot", async ({ page }) => {
    // Wait for React to mount the landing view.
    await page.waitForSelector("text=Shift", { timeout: 10_000 });

    await expect(page).toHaveScreenshot("landing-default.png");
  });

  test("creates an editable font through New font", async ({ electronApp, page }) => {
    const workspaceWindow = electronApp.waitForEvent("window");

    await page.getByRole("button", { name: "New font", exact: true }).click();

    const workspacePage = await workspaceWindow;
    await workspacePage.waitForURL(/#\/home$/);
    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();

    await workspacePage.getByRole("button", { name: "Create glyph", exact: true }).click();
    await workspacePage.getByPlaceholder("Search glyphs...").fill("newGlyph");
    await expect(
      workspacePage.getByRole("region", { name: "Glyph catalog surface", exact: true }),
    ).toHaveAttribute("data-filtered-glyph-count", "1");
  });
});
