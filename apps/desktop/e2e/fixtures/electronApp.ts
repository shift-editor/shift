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
  saveAsShiftPath: string;
  copyShiftPath: string;
  exportTtfPath: string;
};

type ShiftOptions = {
  startupFontPath: string | undefined;
  scriptedDialogs: boolean;
  openFontPath: string | undefined;
  saveShiftPaths: readonly string[] | undefined;
  dirtyDocumentChoice: DirtyDocumentChoice;
  dirtyDocumentChoices: readonly DirtyDocumentChoice[] | undefined;
  dirtyDocumentDelayMs: number;
};

/** Base fixture for launcher tests; workspace tests override `startupFontPath`. */
export const test = base.extend<ShiftFixtures & ShiftOptions>({
  startupFontPath: [undefined, { option: true }],
  scriptedDialogs: [false, { option: true }],
  openFontPath: [undefined, { option: true }],
  saveShiftPaths: [undefined, { option: true }],
  dirtyDocumentChoice: ["cancel", { option: true }],
  dirtyDocumentChoices: [undefined, { option: true }],
  dirtyDocumentDelayMs: [0, { option: true }],

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

  saveAsShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "saved-as.shift"));
  },

  copyShiftPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "copied.shift"));
  },

  exportTtfPath: async ({ testRoot }, use) => {
    await use(path.join(testRoot, "exported.ttf"));
  },

  electronApp: async (
    {
      startupFontPath,
      scriptedDialogs,
      openFontPath,
      saveShiftPaths,
      dirtyDocumentChoice,
      dirtyDocumentChoices,
      dirtyDocumentDelayMs,
      testRoot,
      saveShiftPath,
      exportTtfPath,
    },
    use,
    testInfo,
  ) => {
    const userDataDir = path.join(testRoot, "user-data");
    let workspacePath: string | undefined;
    let app: ElectronApplication | null = null;
    let childProcess: ChildProcess | null = null;
    const diagnostics: string[] = [];
    const recordDiagnostic = (message: string) => {
      diagnostics.push(`${new Date().toISOString()} ${message}`);
      if (diagnostics.length > 500) diagnostics.shift();
    };

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
      if (saveShiftPaths) {
        environment.SHIFT_E2E_SAVE_SHIFT_PATHS = JSON.stringify(saveShiftPaths);
      }
      environment.SHIFT_E2E_EXPORT_TTF_PATH = exportTtfPath;
      environment.SHIFT_E2E_DIRTY_DOCUMENT_CHOICE = dirtyDocumentChoice;
      if (dirtyDocumentChoices) {
        environment.SHIFT_E2E_DIRTY_DOCUMENT_CHOICES = dirtyDocumentChoices.join(",");
      }
      if (dirtyDocumentDelayMs > 0) {
        environment.SHIFT_E2E_DIRTY_DOCUMENT_DELAY_MS = String(dirtyDocumentDelayMs);
      }
      if (openFontPath) environment.SHIFT_E2E_OPEN_FONT_PATH = openFontPath;
    }

    try {
      app = await electron.launch({
        args: [MAIN_JS, `--user-data-dir=${userDataDir}`, "--force-device-scale-factor=1"],
        env: environment,
      });
      childProcess = app.process();
      childProcess.once("exit", (code, signal) => {
        recordDiagnostic(`Electron exited: code=${code ?? "null"}, signal=${signal ?? "null"}`);
      });
      childProcess.stdout?.on("data", (data) =>
        recordDiagnostic(`main stdout: ${String(data).trim()}`),
      );
      childProcess.stderr?.on("data", (data) =>
        recordDiagnostic(`main stderr: ${String(data).trim()}`),
      );

      const observePage = (observedPage: Page) => {
        recordDiagnostic(`window opened: ${observedPage.url()}`);
        observedPage.on("console", (message) => {
          if (message.type() === "error" || message.type() === "warning") {
            recordDiagnostic(`renderer ${message.type()}: ${message.text()}`);
          }
        });
        observedPage.on("pageerror", (error) => recordDiagnostic(`renderer error: ${error.stack}`));
        observedPage.on("crash", () => recordDiagnostic(`renderer crashed: ${observedPage.url()}`));
        observedPage.on("close", () => recordDiagnostic(`window closed: ${observedPage.url()}`));
      };
      for (const observedPage of app.windows()) observePage(observedPage);
      app.on("window", observePage);

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
      if (testInfo.status !== testInfo.expectedStatus) {
        if (app) {
          for (const [index, observedPage] of app.windows().entries()) {
            try {
              recordDiagnostic(
                `final window ${index}: title=${await observedPage.title()}, url=${observedPage.url()}`,
              );
            } catch (error) {
              recordDiagnostic(`final window ${index} unavailable: ${String(error)}`);
            }
          }
        }
        await testInfo.attach("electron-diagnostics", {
          body: diagnostics.join("\n"),
          contentType: "text/plain",
        });
      }

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
    await waitForWorkspaceReady(page);
    await use(page);
  },
});

/** Authored workspace fixture with deterministic native dialog destinations. */
export const documentWorkspaceTest = documentTest.extend<ShiftOptions>({
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await waitForWorkspaceReady(page);
    await use(page);
  },
});

/**
 * Waits until an authored workspace has published its loaded font and catalog.
 *
 * @param page - workspace window whose renderer state must settle.
 */
export async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForURL(/#\/home/, { timeout: 20_000 });
  await page.waitForFunction(() => window.shift?.font.loaded === true, undefined, {
    timeout: 20_000,
  });
  await page.getByLabel("Glyph catalog", { exact: true }).waitFor({ state: "visible" });
}

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
