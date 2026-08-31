import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "@playwright/test";
import nativeBridge from "../crates/shift-bridge/index.js";

const execFileAsync = promisify(execFile);
const availableCaptures = [
  "launcher",
  "document",
  "file-association",
  "application-menu",
  "native-dialog",
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
const captures = new Set(captureArgument ? captureArgument.split(",") : availableCaptures);
const unsupportedCaptures = [...captures].filter((capture) => !availableCaptures.includes(capture));
if (unsupportedCaptures.length > 0) {
  throw new Error(`Unsupported installed app captures: ${unsupportedCaptures.join(", ")}`);
}
if (!fs.existsSync(executablePath)) {
  throw new Error(`Installed application executable does not exist: ${executablePath}`);
}

const testRoot = await mkdtemp(path.join(os.tmpdir(), "shift-installed-screenshots-"));
const documentPath = path.join(testRoot, "Installed app – association.shift");
await mkdir(outputPath, { recursive: true });

try {
  createDocument(documentPath);
  if (captures.has("file-association")) await captureRegistration();
  await writeMetadata();
  if (captures.has("launcher") || captures.has("application-menu")) {
    await captureLauncherAndMenu();
  }
  if (captures.has("document")) await captureDocument();
  if (captures.has("file-association")) await captureFileAssociation();
  if (captures.has("native-dialog")) await captureNativeDialog();
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

async function captureNativeDialog() {
  const app = await launchInstalledApp("native-dialog");

  try {
    await readyLauncher(app);
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const item = Menu.getApplicationMenu()?.getMenuItemById("file.open");
      if (!window || !item) throw new Error("Installed app did not expose its Open command");

      window.focus();
      item.click(item, window, {});
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await writeScreenshot("native-dialog.png", await captureDesktop(app));
  } finally {
    await terminateApplication(app);
  }
}

async function launchInstalledApp(profileName, additionalArguments = []) {
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
  await page.waitForURL(/#\/home/, { timeout: 30_000 });
  await page.waitForFunction(() => window.shift?.font.loaded === true, undefined, {
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
      const fileType = await commandOutput("xdg-mime", ["query", "filetype", documentPath]);
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
      if (fileType.trim() !== "application/x-shift-document") {
        throw new Error(`Unexpected installed MIME type: ${fileType.trim()}`);
      }
      if (!defaultApplication.toLowerCase().includes("shift")) {
        throw new Error(`Shift is not the installed MIME handler: ${defaultApplication.trim()}`);
      }
      await writeFile(
        path.join(outputPath, "registration.txt"),
        `file type: ${fileType}default application: ${defaultApplication}\n${gioInfo}`,
      );

      const iconPath = "/usr/share/icons/hicolor/256x256/mimetypes/shift-document.png";
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, path.join(outputPath, "document-icon.png"));
      }
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
      await captureWindowsDocumentIcon();
      return;
    }
    case "darwin":
      return;
    default:
      throw new Error(`Unsupported registration platform: ${process.platform}`);
  }
}

async function captureWindowsDocumentIcon() {
  const iconPath = path.join(outputPath, "document-icon.png");
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "Add-Type -AssemblyName System.Drawing",
        "$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:SHIFT_SCREENSHOT_DOCUMENT)",
        "if (-not $icon) { throw 'Windows did not resolve a document icon' }",
        "$bitmap = $icon.ToBitmap()",
        "$bitmap.Save($env:SHIFT_SCREENSHOT_ICON, [System.Drawing.Imaging.ImageFormat]::Png)",
        "$bitmap.Dispose()",
        "$icon.Dispose()",
      ].join("; "),
    ],
    {
      env: {
        ...process.env,
        SHIFT_SCREENSHOT_DOCUMENT: documentPath,
        SHIFT_SCREENSHOT_ICON: iconPath,
      },
    },
  );
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
