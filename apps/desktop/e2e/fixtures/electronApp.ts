import {
  test as base,
  _electron as electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { createBridge } from "@shift/bridge";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { once } from "events";
import type { Unicode } from "@shift/types";
import { createAuthoredDocument } from "./fontSource";

const APP_ROOT = path.resolve(__dirname, "../..");
const MAIN_JS = path.join(APP_ROOT, ".vite/build/main.js");
const FONT_PATH = path.resolve(APP_ROOT, "../../fixtures/fonts/mutatorsans/MutatorSans.ttf");

/** Fixed window size for deterministic snapshots. */
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ShiftFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

type ShiftOptions = {
  startupFontPath: string | undefined;
};

export type RecoveryApp = {
  page: Page;
  documentPath: string;
  crashAndRestart: () => Promise<Page>;
  canonicalGlyphNames: () => string[];
};

/** Base fixture for launcher tests; workspace tests override `startupFontPath`. */
export const test = base.extend<ShiftFixtures & ShiftOptions>({
  startupFontPath: [undefined, { option: true }],

  electronApp: async ({ startupFontPath }, use) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-e2e-"));
    const userDataDir = path.join(testRoot, "user-data");
    let workspacePath: string | undefined;
    let app: ElectronApplication | null = null;

    if (startupFontPath) {
      workspacePath = createAuthoredDocument(startupFontPath, path.join(testRoot, "workspace"));
    }

    try {
      app = await launchShiftApp(userDataDir, workspacePath);
      await use(app);
    } finally {
      if (app) await killApp(app);
      fs.rmSync(testRoot, { recursive: true, force: true });
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
          app = await launchShiftApp(userDataDir, documentPath);
          page = await readyWorkspacePage(app);
          return page;
        },
        canonicalGlyphNames: () => readCanonicalGlyphNames(documentPath, testRoot),
      });
    } finally {
      if (app) await killApp(app);
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  },
});

/** Workspace fixture that starts directly with MutatorSans instead of visiting the launcher. */
export const workspaceTest = test.extend<ShiftOptions>({
  startupFontPath: FONT_PATH,

  page: async ({ page }, use) => {
    await page.waitForURL(/#\/home/, { timeout: 20_000 });
    await page.getByLabel("Glyph catalog").waitFor({ state: "visible" });
    await use(page);
  },
});

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
  else delete environment.SHIFT_E2E_FONT_PATH;

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
    await browserWindow.evaluate(
      (win, { w, h }) => {
        win.unmaximize();
        win.setSize(w, h);
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
  await page.waitForURL(/#\/home/, { timeout: 20_000 });
  await page.getByLabel("Glyph catalog").waitFor({ state: "visible" });
  return page;
}

async function killApp(app: ElectronApplication): Promise<void> {
  const childProcess = app.process();
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;

  const exited = once(childProcess, "exit");
  childProcess.kill("SIGKILL");
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
