import { test, expect, loadFont } from "./fixtures/electronApp";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ electronApp, page }) => {
    await loadFont(electronApp, page);

    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });
});
