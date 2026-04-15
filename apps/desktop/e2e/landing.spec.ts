import { test, expect } from "./fixtures/electronApp";

test.describe("Landing view", () => {
  test("matches default snapshot", async ({ page }) => {
    // Wait for React to mount the landing view.
    await page.waitForSelector("text=Shift", { timeout: 10_000 });

    await expect(page).toHaveScreenshot("landing-default.png");
  });
});
