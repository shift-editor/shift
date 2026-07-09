import { test, expect } from "./fixtures/electronApp";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ workspacePage: page }) => {
    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });
});
