import { test, workspaceTest, expect } from "./fixtures/electronApp";
import { runCommand } from "./fixtures/documentLifecycle";

// Window behavior must be observed before visual normalization changes native geometry.
test.use({ windowSizing: "native" });

test("opens the launcher at 960×720, within 90% of the screen", async ({ electronApp, page }) => {
  await expect(page.getByRole("button", { name: "New Font", exact: true })).toBeVisible();
  const browserWindow = await electronApp.browserWindow(page);
  const workArea = await electronApp.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const expected = [
    Math.min(960, Math.round(workArea.width * 0.9)),
    Math.min(720, Math.round(workArea.height * 0.9)),
  ];

  try {
    await expect.poll(() => browserWindow.evaluate((window) => window.getSize())).toEqual(expected);
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
