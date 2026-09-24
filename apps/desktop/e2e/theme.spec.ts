import { workspaceTest as test, expect } from "./fixtures/electronApp";

test.describe("Theme", () => {
  test("light theme home view matches snapshot", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("themeSelection", "shift-light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "shift-light");

    await expect(page).toHaveScreenshot("theme-light-home.png");
  });

  test("selects and persists a classic color theme", async ({ page }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          background: getComputedStyle(document.documentElement)
            .getPropertyValue("--color-background")
            .trim(),
          handle: getComputedStyle(document.documentElement)
            .getPropertyValue("--editor-handle-primary-stroke")
            .trim(),
        })),
      )
      .toEqual({ background: "#2e3440", handle: "#81a1c1" });

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
  });
});
