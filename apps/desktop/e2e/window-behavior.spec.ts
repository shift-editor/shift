import { test, workspaceTest, expect } from "./fixtures/electronApp";
import { runCommand } from "./fixtures/documentLifecycle";

// Window behavior must be observed before visual normalization changes native geometry.
test.use({ windowSizing: "native" });

test("opens the launcher at its compact native size", async ({ electronApp, page }) => {
  await expect(page.getByRole("button", { name: "New font", exact: true })).toBeVisible();
  const browserWindow = await electronApp.browserWindow(page);

  try {
    await expect
      .poll(() => browserWindow.evaluate((window) => window.getSize()))
      .toEqual([800, 600]);
  } finally {
    await browserWindow.dispose();
  }
});

workspaceTest("opens a startup document in a maximized window", async ({ electronApp, page }) => {
  const browserWindow = await electronApp.browserWindow(page);

  try {
    await expect
      .poll(() => browserWindow.evaluate((window) => window.isMaximized()), { timeout: 20_000 })
      .toBe(true);
  } finally {
    await browserWindow.dispose();
  }
});

workspaceTest(
  "restores and maximizes a document through window commands",
  async ({ electronApp, page }) => {
    const browserWindow = await electronApp.browserWindow(page);

    try {
      await expect.poll(() => browserWindow.evaluate((window) => window.isMaximized())).toBe(true);
      await runCommand(page, electronApp, "window.maximise");
      await expect.poll(() => browserWindow.evaluate((window) => window.isMaximized())).toBe(false);
      await expect(page.getByLabel("Glyph catalog", { exact: true })).toBeVisible();

      await runCommand(page, electronApp, "window.maximise");
      await expect.poll(() => browserWindow.evaluate((window) => window.isMaximized())).toBe(true);
      await expect(page.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    } finally {
      await browserWindow.dispose();
    }
  },
);
