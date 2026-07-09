import {
  test as base,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import * as path from "path";
import * as os from "os";
import { promises as fs } from "fs";

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
  workspacePage: Page;
};

/**
 * Base test fixture — launches Electron, lands on the Landing view.
 */
export const test = base.extend<ShiftFixtures>({
  electronApp: async ({}, use, testInfo) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "shift-e2e-"));
    const launchEnvironment = { ...process.env };
    if (testInfo.project.name === "perf") {
      delete launchEnvironment.LIBGL_ALWAYS_SOFTWARE;
    } else {
      launchEnvironment.LIBGL_ALWAYS_SOFTWARE = "1";
    }

    const app = await electron.launch({
      args: [MAIN_JS],
      env: {
        ...launchEnvironment,
        NODE_ENV: "test",
        SHIFT_E2E_USER_DATA_PATH: userDataPath,
      },
    });
    app.process().stderr?.on("data", (chunk) => {
      console.error(`[main] ${String(chunk).trimEnd()}`);
    });

    // Unmaximize and set a fixed size so snapshots are deterministic.
    await app.evaluate(
      async ({ BrowserWindow }, { w, h }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.unmaximize();
          win.setContentSize(w, h);
          win.center();
        }
      },
      { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
    );

    try {
      await use(app);
    } finally {
      if (app.process().exitCode === null) {
        const closed = app.waitForEvent("close");
        await app.evaluate(({ app }) => app.exit(0));
        await closed;
      }

      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Auto-dismiss native save dialogs that interrupt tests.
    page.on("dialog", (dialog) => dialog.dismiss());

    await use(page);
  },

  workspacePage: async ({ electronApp }, use) => {
    const page = await loadFont(electronApp);
    page.on("dialog", (dialog) => dialog.dismiss());

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Font-loading helpers
// ---------------------------------------------------------------------------

/**
 * Open MutatorSans through the application workspace flow.
 *
 * @returns the workspace page created for the font.
 */
export async function loadFont(electronApp: ElectronApplication): Promise<Page> {
  const launcher = await electronApp.firstWindow();
  await launcher.waitForLoadState("domcontentloaded");

  const workspaceWindow = electronApp.waitForEvent("window");

  await electronApp.evaluate(async (_electron, fontPath) => {
    if (!globalThis.shiftTest) throw new Error("Shift test runtime is unavailable");

    await globalThis.shiftTest.openPath(fontPath);
  }, FONT_PATH);

  const page = await workspaceWindow;
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[renderer] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    console.error("[renderer] uncaught error", error);
  });
  page.on("requestfailed", (request) => {
    console.error(
      `[renderer] request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    );
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForURL(/#\/home/, { timeout: 10_000 });
  await page.waitForFunction(() => window.shift?.editor.font.loaded === true);

  // The workspace maximises itself after loading. Apply the deterministic E2E
  // viewport after that effect has run.
  await page.waitForTimeout(100);
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate(
    (window, { width, height }) => {
      window.unmaximize();
      window.setContentSize(width, height);
      window.center();
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
  );
  await page.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
  );

  return page;
}

/**
 * Navigate to the editor for Unicode codepoint (hex, e.g. "41" = A).
 * Assumes a font is already loaded.
 */
export async function navigateToEditor(page: Page, hexCodepoint: string): Promise<void> {
  await page.evaluate(async (hex) => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Shift workspace runtime is unavailable");

    const font = workspace.editor.font;
    const handle = font.glyphHandleForUnicode(Number.parseInt(hex, 16));
    const record = font.recordForName(handle.name);
    if (!record) throw new Error(`No glyph record for U+${hex}`);

    await font.loadGlyph(record.id);
    window.location.hash = `#/editor/${record.id}`;
  }, hexCodepoint);

  // Wait for the editor canvas to mount and render.
  await page.waitForSelector("#scene-canvas", { timeout: 10_000 });
  await page.waitForTimeout(1000);
}

export { expect } from "@playwright/test";
