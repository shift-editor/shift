import {
  test as base,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import * as path from "path";

const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");
const FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");

/** Fixed window size for deterministic snapshots. */
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ShiftFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

/**
 * Base test fixture — launches Electron, lands on the Landing view.
 */
export const test = base.extend<ShiftFixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: "test",
        // Force software rendering for deterministic GPU-free snapshots.
        LIBGL_ALWAYS_SOFTWARE: "1",
      },
    });

    // Unmaximize and set a fixed size so snapshots are deterministic.
    await app.evaluate(
      async ({ BrowserWindow }, { w, h }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.unmaximize();
          win.setSize(w, h);
          win.center();
        }
      },
      { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
    );

    await use(app);
    await app.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Font-loading helpers
// ---------------------------------------------------------------------------

/**
 * Open MutatorSans via the `external:open-font` IPC event (same path the OS
 * uses when you double-click a .ttf) and wait for the app to navigate to /home.
 */
export async function loadFont(electronApp: ElectronApplication, page: Page): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow }, fontPath) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send("external:open-font", fontPath);
  }, FONT_PATH);

  // The app navigates to #/home after a successful font load.
  await page.waitForURL(/#\/home/, { timeout: 10_000 });
  // Wait for the glyph grid to render.
  await page.waitForTimeout(500);
}

/**
 * Navigate to the editor for Unicode codepoint (hex, e.g. "41" = A).
 * Assumes a font is already loaded.
 */
export async function navigateToEditor(page: Page, hexCodepoint: string): Promise<void> {
  await page.evaluate((hex) => {
    window.location.hash = `#/editor/${hex}`;
  }, hexCodepoint);

  // Wait for the editor canvas to mount and render.
  await page.waitForSelector("#scene-canvas", { timeout: 10_000 });
  await page.waitForTimeout(1000);
}

export { expect } from "@playwright/test";
