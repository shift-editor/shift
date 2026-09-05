import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "@playwright/test";
import nativeBridge from "../crates/shift-bridge/index.js";
import {
  createFileDialogs,
  createMessageDialogs,
  message,
  screenshotManifest,
} from "./installed-app-screenshot-scenarios.mjs";

const execFileAsync = promisify(execFile);
const availableCaptures = [
  "launcher",
  "document",
  "file-association",
  "application-menu",
  "file-dialogs",
  "message-dialogs",
  "preview-dialogs",
  "react-errors",
  "update-window",
  "settings-error",
];
const [executableArgument, outputArgument, captureArgument] = process.argv.slice(2);
if (!executableArgument || !outputArgument) {
  throw new Error(
    "Usage: node scripts/capture-installed-app.mjs <installed-executable> <output-directory> [captures]",
  );
}

const executablePath = path.resolve(executableArgument);
const outputPath = path.resolve(outputArgument);
const sourcePath = path.resolve("fixtures/fonts/mutatorsans/MutatorSans.ttf");
const convertibleSourcePath = path.resolve(
  "fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo",
);
const packageJson = JSON.parse(await readFile(path.resolve("apps/desktop/package.json"), "utf8"));
const applicationName = "Shift";
const updateVersion = packageJson.version;
const captures = new Set(captureArgument ? captureArgument.split(",") : availableCaptures);
const unsupportedCaptures = [...captures].filter((capture) => !availableCaptures.includes(capture));
if (unsupportedCaptures.length > 0) {
  throw new Error(`Unsupported installed app captures: ${unsupportedCaptures.join(", ")}`);
}
if (!fs.existsSync(executablePath)) {
  throw new Error(`Installed application executable does not exist: ${executablePath}`);
}

const messageDialogs = createMessageDialogs(applicationName, updateVersion);
const testRoot = await mkdtemp(path.join(os.tmpdir(), "shift-installed-screenshots-"));
const documentPath = path.join(testRoot, "Installed app – association.shift");
let desktopCaptureIndex = 0;
await mkdir(outputPath, { recursive: true });

try {
  createDocument(documentPath);
  if (captures.has("file-association")) await captureRegistration();
  if (captures.has("launcher") || captures.has("application-menu")) {
    await captureLauncherAndMenu();
  }
  if (captures.has("document")) await captureDocument();
  if (captures.has("file-association")) await captureFileAssociation();
  if (captures.has("file-dialogs")) await captureFileDialogs();
  if (captures.has("message-dialogs")) await captureMessageDialogs();
  if (captures.has("preview-dialogs")) await capturePreviewDialogs();
  if (captures.has("react-errors")) await captureReactErrors();
  if (captures.has("update-window")) await captureUpdateWindow();
  if (captures.has("settings-error")) await captureSettingsError();
  await writeMetadata();
} finally {
  await rm(testRoot, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
}

function createDocument(destinationPath) {
  const bridge = new nativeBridge.Bridge();
  const workspacePath = path.join(testRoot, "fixture-workspace.sqlite");
  const recoveryPath = path.join(testRoot, "fixture-recovery.sqlite");

  try {
    bridge.openWorkspace(sourcePath, workspacePath);
    bridge.saveWorkspaceAsDocument(destinationPath, recoveryPath);
  } finally {
    bridge.closeWorkspace();
  }
}

async function captureLauncherAndMenu() {
  const app = await launchInstalledApp("launcher");

  try {
    const page = await readyLauncher(app);
    if (captures.has("launcher")) await captureWindowAndDesktop(app, page, "launcher");
    if (captures.has("application-menu")) await captureApplicationMenu(app);
  } finally {
    await terminateApplication(app);
  }
}

async function captureDocument() {
  const app = await launchInstalledApp("document", [documentPath]);

  try {
    const workspace = await app.firstWindow();
    await readyWorkspace(workspace);
    await captureWindowAndDesktop(app, workspace, "document");
  } finally {
    await terminateApplication(app);
  }
}

async function captureFileAssociation() {
  switch (process.platform) {
    case "linux": {
      const app = await launchInstalledApp("file-association", [documentPath]);

      try {
        const workspace = await app.firstWindow();
        await readyWorkspace(workspace);
        await captureWindowAndDesktop(app, workspace, "file-association");
      } finally {
        await terminateApplication(app);
      }
      return;
    }
    default: {
      const app = await launchInstalledApp();

      try {
        await readyLauncher(app);
        const workspacePromise = app.waitForEvent("window");
        await openDocumentWithOperatingSystem(documentPath);
        const workspace = await workspacePromise;
        await readyWorkspace(workspace);
        await captureWindowAndDesktop(app, workspace, "file-association");
      } finally {
        await terminateApplication(app);
      }
    }
  }
}

async function captureFileDialogs() {
  for (const scenario of createFileDialogs(testRoot)) await captureNativeDialog(scenario);
}

async function captureMessageDialogs() {
  for (const scenario of messageDialogs) await captureNativeDialog(scenario);
}

async function captureNativeDialog(scenario) {
  const profileName = path.basename(scenario.fileName, ".png");
  const app = await launchInstalledApp(profileName);

  try {
    await readyLauncher(app);
    await app.evaluate(({ BrowserWindow, dialog }, request) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Installed app did not open a window for its native dialog");

      window.focus();
      switch (request.kind) {
        case "message":
          void dialog.showMessageBox(window, request.options);
          break;
        case "open":
          void dialog.showOpenDialog(window, request.options);
          break;
        case "save":
          void dialog.showSaveDialog(window, request.options);
          break;
        default:
          throw new Error(`Unsupported native dialog kind: ${request.kind}`);
      }
    }, scenario);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await writeScreenshot(scenario.fileName, await captureDesktop(app));
  } finally {
    await terminateApplication(app);
  }
}

async function capturePreviewDialogs() {
  await capturePreviewDialog({
    sourcePath: convertibleSourcePath,
    title: message("preview.convertible.title"),
    fileName: "preview-convertible.png",
  });
  await capturePreviewDialog({
    sourcePath,
    title: message("preview.readOnly.title"),
    fileName: "preview-view-only.png",
  });
}

async function capturePreviewDialog(scenario) {
  const profileName = path.basename(scenario.fileName, ".png");
  const app = await launchInstalledApp(profileName, [], {
    SHIFT_E2E_FONT_PATH: scenario.sourcePath,
  });

  try {
    const page = await app.firstWindow();
    await readyFontSession(page);
    await page.getByRole("button", { name: "Read-only preview", exact: true }).click();
    await page.getByRole("dialog", { name: scenario.title, exact: true }).waitFor();
    await page.screenshot({ path: path.join(outputPath, scenario.fileName) });
  } finally {
    await terminateApplication(app);
  }
}

async function captureReactErrors() {
  await captureApplicationError();
  await captureDocumentError();
}

async function captureApplicationError() {
  const app = await launchInstalledApp("react-app-error");

  try {
    const page = await readyLauncher(app);
    await page.evaluate(() => {
      window.location.hash = "/e2e-root-render-failure";
    });
    await page.getByRole("heading", { name: message("error.app.title") }).waitFor();
    await page.screenshot({ path: path.join(outputPath, "react-app-error.png") });
    await page.getByRole("button", { name: message("error.details.show") }).click();
    await page.getByLabel(message("error.details.label")).waitFor();
    await page.screenshot({ path: path.join(outputPath, "react-app-error-details.png") });
  } finally {
    await terminateApplication(app);
  }
}

async function captureDocumentError() {
  const app = await launchInstalledApp("react-document-error", [documentPath]);

  try {
    const page = await app.firstWindow();
    await readyWorkspace(page);
    await page.evaluate(() => {
      window.location.hash = "/e2e-document-render-failure";
    });
    await page.getByRole("heading", { name: message("error.document.title") }).waitFor();
    await page.screenshot({ path: path.join(outputPath, "react-document-error.png") });
    await page.getByRole("button", { name: message("error.details.show") }).click();
    await page.getByLabel(message("error.details.label")).waitFor();
    await page.screenshot({ path: path.join(outputPath, "react-document-error-details.png") });
  } finally {
    await terminateApplication(app);
  }
}

async function captureUpdateWindow() {
  const app = await launchInstalledApp("update-window");

  try {
    const page = await readyLauncher(app);
    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(420, 320));
    await browserWindow.dispose();

    const scenarios = [
      {
        state: "available",
        heading: message("update.available.title", {
          applicationName,
          version: updateVersion,
        }),
        fileName: "update-available.png",
      },
      {
        state: "downloading",
        heading: message("update.downloading.preparing"),
        fileName: "update-downloading.png",
      },
      {
        state: "ready",
        heading: message("update.ready.title", {
          applicationName,
          version: updateVersion,
        }),
        fileName: "update-ready.png",
      },
    ];

    for (const scenario of scenarios) {
      await page.evaluate((route) => {
        window.location.hash = route;
      }, `/update?state=${scenario.state}&version=${updateVersion}`);
      await page.getByRole("heading", { name: scenario.heading, exact: true }).waitFor();
      await page.screenshot({ path: path.join(outputPath, scenario.fileName) });
      await page.evaluate(() => {
        window.location.hash = "/launcher";
      });
      await page.getByRole("button", { name: "New font", exact: true }).waitFor();
    }
  } finally {
    await terminateApplication(app);
  }
}

async function captureSettingsError() {
  const app = await launchInstalledApp("settings-save-failed", [documentPath]);

  try {
    const page = await app.firstWindow();
    await readyWorkspace(page);
    await page.evaluate(() => {
      const font = window.shift?.font;
      if (!font) throw new Error("Installed app did not expose an authored font");

      Object.defineProperty(font, "updateMetadata", {
        configurable: true,
        value: async () => {
          throw new Error("Installed screenshot settings failure");
        },
      });
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: message("settings.dialog.title") });
    await dialog.getByLabel("Family Name").fill("Screenshot failure");
    await dialog.getByRole("heading", { name: "Font", exact: true }).click();
    await dialog.getByText(message("settings.fontSaveFailed"), { exact: true }).waitFor();
    await page.screenshot({ path: path.join(outputPath, "settings-save-failed.png") });
  } finally {
    await terminateApplication(app);
  }
}

async function launchInstalledApp(
  profileName,
  additionalArguments = [],
  additionalEnvironment = {},
) {
  const args = ["--force-device-scale-factor=1", ...additionalArguments];
  if (profileName) {
    args.push(`--user-data-dir=${path.join(testRoot, `user-data-${profileName}`)}`);
  }

  return electron.launch({
    executablePath,
    args,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      LIBGL_ALWAYS_SOFTWARE: "1",
      ...additionalEnvironment,
    },
    timeout: 30_000,
  });
}

async function readyLauncher(app) {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New font", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  return page;
}

async function readyWorkspace(page) {
  await readyFontSession(page);
  await page.waitForFunction(() => window.shift?.font.loaded === true, undefined, {
    timeout: 30_000,
  });
}

async function readyFontSession(page) {
  await page.waitForURL(/#\/home/, { timeout: 30_000 });
  await page.waitForFunction(() => window.shiftSession?.font.loaded === true, undefined, {
    timeout: 30_000,
  });
  await page.getByLabel("Glyph catalog", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function captureWindowAndDesktop(app, page, name) {
  const browserWindow = await app.browserWindow(page);
  await browserWindow.evaluate((window) => window.focus());
  await browserWindow.dispose();
  await page.screenshot({ path: path.join(outputPath, `${name}.png`) });

  await new Promise((resolve) => setTimeout(resolve, 500));
  await writeScreenshot(`${name}-desktop.png`, await captureDesktop(app));
}

async function captureApplicationMenu(app) {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const fileMenu = Menu.getApplicationMenu()?.items.find(
      (item) => item.label === "File",
    )?.submenu;
    if (!window || !fileMenu) throw new Error("Installed app did not expose its File menu");

    window.focus();
    fileMenu.popup({ window, x: 24, y: 24 });
  });
  await new Promise((resolve) => setTimeout(resolve, 750));

  try {
    await writeScreenshot("application-menu.png", await captureDesktop(app));
  } finally {
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "File")
        ?.submenu?.closePopup(window ?? undefined);
    });
  }
}

async function captureDesktop(app) {
  if (process.platform === "darwin") {
    const screenshotPath = path.join(testRoot, `desktop-${desktopCaptureIndex}.png`);
    desktopCaptureIndex += 1;
    await execFileAsync("screencapture", ["-x", "-t", "png", screenshotPath]);
    return (await readFile(screenshotPath)).toString("base64");
  }

  return app.evaluate(async ({ desktopCapturer, screen }) => {
    const display = screen.getPrimaryDisplay();
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
    });
    const source =
      sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Electron could not capture the primary display");
    }
    return source.thumbnail.toPNG().toString("base64");
  });
}

async function writeScreenshot(fileName, base64) {
  await writeFile(path.join(outputPath, fileName), Buffer.from(base64, "base64"));
}

async function openDocumentWithOperatingSystem(openPath) {
  switch (process.platform) {
    case "darwin":
      await execFileAsync("open", [openPath]);
      return;
    case "linux":
      await execFileAsync("gio", ["open", openPath]);
      return;
    case "win32":
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Start-Process -FilePath $env:SHIFT_SCREENSHOT_DOCUMENT",
        ],
        { env: { ...process.env, SHIFT_SCREENSHOT_DOCUMENT: openPath } },
      );
      return;
    default:
      throw new Error(`Unsupported installed screenshot platform: ${process.platform}`);
  }
}

async function captureRegistration() {
  switch (process.platform) {
    case "linux": {
      const defaultApplication = await commandOutput("xdg-mime", [
        "query",
        "default",
        "application/x-shift-document",
      ]);
      const gioInfo = await commandOutput("gio", [
        "info",
        "-a",
        "standard::content-type,standard::icon",
        documentPath,
      ]);
      const fileType = gioInfo.match(/^\s*standard::content-type:\s*(\S+)\s*$/m)?.[1];
      if (fileType !== "application/x-shift-document") {
        throw new Error(`Unexpected installed MIME type: ${fileType ?? "not reported"}`);
      }
      if (!defaultApplication.toLowerCase().includes("shift")) {
        throw new Error(`Shift is not the installed MIME handler: ${defaultApplication.trim()}`);
      }
      await writeFile(
        path.join(outputPath, "registration.txt"),
        `file type: ${fileType}\ndefault application: ${defaultApplication.trim()}\n\n${gioInfo}`,
      );

      return;
    }
    case "win32": {
      const extension = await commandOutput("reg.exe", [
        "query",
        "HKCU\\Software\\Classes\\.shift",
        "/ve",
      ]);
      const command = await commandOutput("reg.exe", [
        "query",
        "HKCU\\Software\\Classes\\app.shift.document\\shell\\open\\command",
        "/ve",
      ]);
      if (!extension.includes("app.shift.document")) {
        throw new Error("Release installer did not register .shift ownership");
      }
      if (!command.toLowerCase().includes("shift.exe")) {
        throw new Error("Release installer did not register the Shift open command");
      }
      await writeFile(
        path.join(outputPath, "registration.txt"),
        `${extension.trim()}\n\n${command.trim()}\n`,
      );
      return;
    }
    case "darwin":
      return;
    default:
      throw new Error(`Unsupported registration platform: ${process.platform}`);
  }
}

async function commandOutput(command, args) {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function writeMetadata() {
  const metadata = {
    platform: process.platform,
    architecture: process.arch,
    executablePath,
    captures: [...captures],
    screenshots: screenshotManifest,
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(outputPath, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function terminateApplication(app) {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;

  switch (process.platform) {
    case "win32":
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      break;
    default:
      child.kill("SIGKILL");
      break;
  }

  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
