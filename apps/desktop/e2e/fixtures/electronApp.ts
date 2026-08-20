import {
  test as base,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { once } from "events";
import type { Unicode } from "@shift/types";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import { createAuthoredPackage } from "./fontSource";

const APP_ROOT = path.resolve(__dirname, "../..");
export const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");
export const FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");

/** Fixed window size for deterministic snapshots. */
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ShiftFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  testRoot: string;
  saveShiftPath: string;
  exportTtfPath: string;
};

type ShiftOptions = {
  startupFontPath: string | undefined;
  scriptedDialogs: boolean;
  openFontPath: string | undefined;
  dirtyDocumentChoice: DirtyDocumentChoice;
};

/** Base fixture for launcher tests; workspace tests override `startupFontPath`. */
export const test = base.extend<ShiftFixtures & ShiftOptions>({
  startupFontPath: [undefined, { option: true }],
  scriptedDialogs: [false, { option: true }],
  openFontPath: [undefined, { option: true }],
  dirtyDocumentChoice: ["cancel", { option: true }],

  testRoot: async ({}, use) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-"));

    try {
      await use(testRoot);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  },

  saveShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "saved.shift"));
  },

  exportTtfPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "exported.ttf"));
  },

  electronApp: async (
    {
      startupFontPath,
      scriptedDialogs,
      openFontPath,
      dirtyDocumentChoice,
      testRoot,
      saveShiftPath,
      exportTtfPath,
    },
    use,
  ) => {
    const userDataDir = path.join(testRoot, "user-data");
    let workspacePath: string | undefined;
    let app: ElectronApplication | null = null;
    let childProcess: ChildProcess | null = null;

    if (startupFontPath) {
      workspacePath = createAuthoredPackage(startupFontPath, path.join(testRoot, "workspace"));
    }

    const environment = {
      ...process.env,
      NODE_ENV: "test",
      // Force software rendering for deterministic GPU-free snapshots.
      LIBGL_ALWAYS_SOFTWARE: "1",
    };
    if (workspacePath) environment.SHIFT_E2E_FONT_PATH = workspacePath;
    else delete environment.SHIFT_E2E_FONT_PATH;

    if (scriptedDialogs) {
      environment.SHIFT_E2E_NATIVE_DIALOGS = "1";
      environment.SHIFT_E2E_SAVE_SHIFT_PATH = saveShiftPath;
      environment.SHIFT_E2E_EXPORT_TTF_PATH = exportTtfPath;
      environment.SHIFT_E2E_DIRTY_DOCUMENT_CHOICE = dirtyDocumentChoice;
      if (openFontPath) environment.SHIFT_E2E_OPEN_FONT_PATH = openFontPath;
    }

    try {
      app = await electron.launch({
        args: [MAIN_JS, `--user-data-dir=${userDataDir}`, "--force-device-scale-factor=1"],
        env: environment,
      });
      childProcess = app.process();

      // Size the window that owns the test page instead of whichever app window was created first.
      const page = await app.firstWindow();
      const activeUserDataDir = await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath("userData"),
      );
      if (fs.realpathSync(activeUserDataDir) !== fs.realpathSync(userDataDir)) {
        throw new Error(`Electron ignored isolated user data directory: ${activeUserDataDir}`);
      }
      const browserWindow = await app.browserWindow(page);
      await browserWindow.evaluate(
        (win, { w, h }) => {
          win.unmaximize();
          win.setSize(w, h);
          win.center();
        },
        { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
      );
      await browserWindow.dispose();
      await page.waitForFunction(
        ({ w, h }) => window.innerWidth === w && window.innerHeight === h,
        { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
      );

      await use(app);
    } finally {
      if (childProcess && childProcess.exitCode === null && childProcess.signalCode === null) {
        const exited = once(childProcess, "exit");
        childProcess.kill("SIGKILL");
        await exited;
      }
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Auto-dismiss native save dialogs that interrupt tests.
    page.on("dialog", (dialog) => dialog.dismiss());

    await use(page);
  },
});

/** Fixture whose native outer-dialog choices are supplied by deterministic E2E paths. */
export const documentTest = test.extend<ShiftOptions>({
  scriptedDialogs: [true, { option: true }],
});

/** Workspace fixture that starts directly with MutatorSans instead of visiting the launcher. */
export const workspaceTest = test.extend<ShiftOptions>({
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await page.waitForURL(/#\/home/, { timeout: 20_000 });
    await page.getByLabel("Glyph catalog", { exact: true }).waitFor({ state: "visible" });
    await use(page);
  },
});

/** Authored workspace fixture with deterministic native dialog destinations. */
export const documentWorkspaceTest = documentTest.extend<ShiftOptions>({
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await page.waitForURL(/#\/home/, { timeout: 20_000 });
    await page.getByLabel("Glyph catalog", { exact: true }).waitFor({ state: "visible" });
    await use(page);
  },
});

/**
 * Navigate to the editor for Unicode codepoint (hex, e.g. "41" = A).
 * Assumes a font is already loaded.
 */
export async function navigateToEditor(page: Page, hexCodepoint: string): Promise<void> {
  const unicode = Number.parseInt(hexCodepoint, 16) as Unicode;
  await page.waitForFunction(
    (codepoint) => {
      const font = window.shift?.font;
      if (!font) return false;

      const handle = font.glyphHandleForUnicode(codepoint as Unicode);
      return font.recordForName(handle.name) !== null;
    },
    unicode,
    { timeout: 20_000 },
  );

  await page.evaluate(async (codepoint) => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const handle = workspace.font.glyphHandleForUnicode(codepoint as Unicode);
    const record = workspace.font.recordForName(handle.name);
    if (!record) throw new Error(`No glyph found for U+${codepoint.toString(16)}`);

    await workspace.font.loadGlyph(record.id);
    window.location.hash = `#/editor/${encodeURIComponent(record.id)}`;
  }, unicode);

  // Wait for the editor canvas to mount and render.
  await page.waitForSelector("#scene-canvas", { timeout: 10_000 });
  await page.waitForTimeout(1000);
}

export { expect } from "@playwright/test";
