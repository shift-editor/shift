import type { ElectronApplication, Page } from "@playwright/test";
import type { GlyphName } from "@shift/types";
import { expect, workspaceTest as test, waitForWorkspaceReady } from "./fixtures/electronApp";

test.setTimeout(90_000);
test.use({ scriptedDialogs: true });

test("reopens a crashed document renderer with completed edits", async ({ electronApp, page }) => {
  const glyphName = "rendererCrashRecovery" as GlyphName;
  await page.evaluate((name) => {
    window.shift?.editor.createGlyph(name);
  }, glyphName);
  await waitForGlyph(page, glyphName);

  const reopenedPage = await crashRendererAndWaitForWindow(electronApp, page);
  await waitForWorkspaceReady(reopenedPage);
  await waitForGlyph(reopenedPage, glyphName);

  await expect.poll(() => electronApp.windows().length).toBe(1);
});

async function crashRendererAndWaitForWindow(
  electronApp: ElectronApplication,
  page: Page,
): Promise<Page> {
  const nextWindow = electronApp.waitForEvent("window");
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) => {
    window.webContents.forcefullyCrashRenderer();
  });
  await browserWindow.dispose();

  const reopenedPage = await nextWindow;
  await reopenedPage.waitForLoadState("domcontentloaded");
  return reopenedPage;
}

async function waitForGlyph(page: Page, glyphName: GlyphName): Promise<void> {
  await page.waitForFunction(
    (name) => {
      const workspace = window.shift;
      return (
        workspace?.applyStatusCell.peek() === "idle" &&
        workspace.documentStateCell.peek()?.dirty === true &&
        workspace.font.recordForName(name as GlyphName) !== null
      );
    },
    glyphName,
    { timeout: 20_000 },
  );
}
