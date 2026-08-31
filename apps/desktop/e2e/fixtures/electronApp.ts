import {
  test as base,
  _electron as electron,
  expect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { createBridge } from "@shift/bridge";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { once } from "events";
import { promisify } from "node:util";
import type { Axis, NamedInstance, Source, Unicode } from "@shift/types";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import { createAuthoredDocument } from "./fontSource";

const APP_ROOT = path.resolve(__dirname, "../..");
export const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");
export const FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");
export const OTF_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans/MutatorSans.otf",
);
export const UFO_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo",
);
export const DESIGNSPACE_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);
export const GLYPHS_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/MutatorSansVariable.glyphs",
);
export const GLYPHSPACKAGE_FONT_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/PackageFont.glyphspackage",
);

/** Native launcher size before deterministic snapshot normalization. */
const LAUNCHER_WIDTH = 800;
const LAUNCHER_HEIGHT = 600;
/** Fixed window size for deterministic snapshots. */
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 600;
const execFileAsync = promisify(execFile);

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
  documentCrashChoice: "reopen" | "close";
};

export interface CanonicalVariableFont {
  axes: Axis[];
  sources: Source[];
  namedInstances: NamedInstance[];
}

export type RecoveryApp = {
  page: Page;
  documentPath: string;
  crashAndRestart: () => Promise<Page>;
  canonicalGlyphNames: () => string[];
  canonicalVariableFont: () => CanonicalVariableFont;
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
  documentCrashChoice: ["reopen", { option: true }],

  testRoot: async ({}, use) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-"));

    try {
      await use(testRoot);
    } finally {
      await fs.promises.rm(testRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
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
      documentCrashChoice,
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
      workspacePath = createAuthoredDocument(startupFontPath, path.join(testRoot, "workspace"));
    }

    const environment = {
      ...process.env,
      NODE_ENV: "test",
      // Force software rendering for deterministic GPU-free snapshots.
      LIBGL_ALWAYS_SOFTWARE: "1",
    };
    delete environment.SHIFT_E2E_FONT_PATH;

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
      environment.SHIFT_E2E_DOCUMENT_CRASH_CHOICE = documentCrashChoice;
    }

    try {
      app = await electron.launch({
        args: [
          MAIN_JS,
          `--user-data-dir=${userDataDir}`,
          "--force-device-scale-factor=1",
          ...(workspacePath ? [workspacePath] : []),
        ],
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
      if (workspacePath) {
        await expect
          .poll(() => browserWindow.evaluate((window) => window.isMaximized()), {
            timeout: 20_000,
          })
          .toBe(true);
      } else {
        await expect
          .poll(() => browserWindow.evaluate((window) => window.getSize()))
          .toEqual([LAUNCHER_WIDTH, LAUNCHER_HEIGHT]);
      }

      await browserWindow.evaluate((window) => window.unmaximize());
      await expect.poll(() => browserWindow.evaluate((window) => window.isMaximized())).toBe(false);
      await browserWindow.evaluate(
        (win, { w, h }) => {
          // Hosted displays can be narrower than the deterministic snapshot size.
          win.setMinimumSize(w, h);
          win.setContentSize(w, h);
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

      if (childProcess) await terminateProcessTree(childProcess);
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

/** Real Electron lifecycle fixture for sparse native recovery tests. */
export const recoveryTest = base.extend<{ recoveryApp: RecoveryApp }>({
  recoveryApp: async ({}, use) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-recovery-e2e-"));
    const userDataDir = path.join(testRoot, "user-data");
    const documentPath = createAuthoredDocument(FONT_PATH, path.join(testRoot, "workspace"));
    let app: ElectronApplication | null = null;
    let page: Page;

    try {
      app = await launchShiftApp(userDataDir, documentPath);
      page = await readyWorkspacePage(app);
      await use({
        page,
        documentPath,
        crashAndRestart: async () => {
          if (!app) throw new Error("Electron application is not running");

          await killApp(app);
          app = await launchShiftApp(userDataDir);
          page = await readyWorkspacePage(app);
          return page;
        },
        canonicalGlyphNames: () => readCanonicalGlyphNames(documentPath, testRoot),
        canonicalVariableFont: () => readCanonicalVariableFont(documentPath, testRoot),
      });
    } finally {
      if (app) await killApp(app);
      await fs.promises.rm(testRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
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

async function launchShiftApp(
  userDataDir: string,
  workspacePath?: string,
): Promise<ElectronApplication> {
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    LIBGL_ALWAYS_SOFTWARE: "1",
  };
  if (workspacePath) environment.SHIFT_E2E_FONT_PATH = workspacePath;

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userDataDir}`, "--force-device-scale-factor=1"],
    env: environment,
  });

  try {
    const page = await app.firstWindow();
    const activeUserDataDir = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath("userData"),
    );
    if (fs.realpathSync(activeUserDataDir) !== fs.realpathSync(userDataDir)) {
      throw new Error(`Electron ignored isolated user data directory: ${activeUserDataDir}`);
    }

    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.unmaximize());
    await expect.poll(() => browserWindow.evaluate((window) => window.isMaximized())).toBe(false);
    await browserWindow.evaluate(
      (win, { w, h }) => {
        win.setContentSize(w, h);
        win.center();
      },
      { w: WINDOW_WIDTH, h: WINDOW_HEIGHT },
    );
    await browserWindow.dispose();
    await page.waitForFunction(({ w, h }) => window.innerWidth === w && window.innerHeight === h, {
      w: WINDOW_WIDTH,
      h: WINDOW_HEIGHT,
    });
    return app;
  } catch (error) {
    await killApp(app);
    throw error;
  }
}

async function readyWorkspacePage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await waitForWorkspaceReady(page);
  return page;
}

/**
 * Force-terminates the application and all descendant processes.
 *
 * @param app - application whose process tree must release test resources.
 * @throws {Error} when the platform termination command cannot stop a running application.
 */
export async function killApp(app: ElectronApplication): Promise<void> {
  await terminateProcessTree(app.process());
}

/** Terminates an Electron process tree through a handle that survives Playwright disconnection. */
async function terminateProcessTree(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  if (process.platform === "win32") {
    const pid = childProcess.pid;
    if (pid === undefined) throw new Error("Electron process has no PID");

    try {
      await execFileAsync("taskkill", ["/F", "/PID", String(pid), "/T"]);
    } catch (error) {
      if (childProcess.exitCode === null && childProcess.signalCode === null) throw error;
    }
  } else {
    childProcess.kill("SIGKILL");
  }

  await exited;
}

function readCanonicalGlyphNames(documentPath: string, testRoot: string): string[] {
  const bridge = createBridge();
  const recoveryPath = path.join(testRoot, `${crypto.randomUUID()}.recovery.sqlite`);
  bridge.openDocument(documentPath, recoveryPath);
  try {
    return bridge.getGlyphs().map((glyph) => glyph.name);
  } finally {
    bridge.closeWorkspace();
    fs.rmSync(recoveryPath, { force: true });
  }
}

function readCanonicalVariableFont(documentPath: string, testRoot: string): CanonicalVariableFont {
  const bridge = createBridge();
  const recoveryPath = path.join(testRoot, `${crypto.randomUUID()}.recovery.sqlite`);
  bridge.openDocument(documentPath, recoveryPath);
  try {
    return {
      axes: bridge.getAxes(),
      sources: bridge.getSources(),
      namedInstances: bridge.getNamedInstances(),
    };
  } finally {
    bridge.closeWorkspace();
    fs.rmSync(recoveryPath, { force: true });
  }
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
