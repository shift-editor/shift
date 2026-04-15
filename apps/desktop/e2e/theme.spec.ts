import { test, expect, loadFont } from "./fixtures/electronApp";

test.describe("Theme", () => {
  test("light theme home view matches snapshot", async ({ electronApp, page }) => {
    await loadFont(electronApp, page);

    // Ensure light theme is active.
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send("theme:set", "light");
    });
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot("theme-light-home.png");
  });

  // Dark theme tests are skipped until the dark theme is implemented
  // (currently dark: lightTheme with a TODO in the codebase).
  test.skip("dark theme home view matches snapshot", async ({ electronApp, page }) => {
    await loadFont(electronApp, page);

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send("theme:set", "dark");
    });
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot("theme-dark-home.png");
  });
});
