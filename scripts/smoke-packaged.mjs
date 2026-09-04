import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

if (process.platform === "linux" && !process.env.DISPLAY) {
  const result = spawnSync("xvfb-run", ["-a", process.execPath, ...process.argv.slice(1)], {
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const [packagePathArgument, distribution = "release"] = process.argv.slice(2);
if (!packagePathArgument) {
  throw new Error("Usage: smoke-packaged.mjs <package-path> [release|nightly]");
}

const packagePath = path.resolve(packagePathArgument);
const macosDocumentTypeIdentifier = "app.shift.document.v2";
const macosDocumentBadgeName = "shift-document-badge-v2";
const macosSourceFontExtensions = ["ttf", "otf", "glyphs", "glyphspackage", "ufo", "designspace"];
const packageName = (() => {
  switch (distribution) {
    case "release":
      return "Shift";
    case "nightly":
      return "Shift Nightly";
    default:
      throw new Error(`Unsupported distribution: ${distribution}`);
  }
})();
const executableName =
  process.platform === "darwin"
    ? packageName
    : distribution === "nightly"
      ? "shift-nightly"
      : "shift";

const executablePath = (() => {
  switch (process.platform) {
    case "darwin":
      return path.join(packagePath, `${packageName}.app`, "Contents", "MacOS", executableName);
    case "linux":
      return path.join(packagePath, executableName);
    case "win32":
      return path.join(packagePath, `${executableName}.exe`);
    default:
      throw new Error(`Unsupported smoke-test platform: ${process.platform}`);
  }
})();

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function commandJson(command, args) {
  return JSON.parse(runCommand(command, args));
}

function verifyMacosDocumentIcon() {
  if (process.platform !== "darwin") return;

  const appPath = path.join(packagePath, `${packageName}.app`);
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const info = commandJson("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
  const documentType = info.CFBundleDocumentTypes?.find(
    ({ LSItemContentTypes }) => LSItemContentTypes?.[0] === macosDocumentTypeIdentifier,
  );
  const exportedType = info.UTExportedTypeDeclarations?.find(
    ({ UTTypeIdentifier }) => UTTypeIdentifier === macosDocumentTypeIdentifier,
  );
  const assets = commandJson("xcrun", [
    "assetutil",
    "--info",
    path.join(resourcesPath, "Assets.car"),
  ]);

  if (documentType?.CFBundleTypeIconSystemGenerated !== true) {
    throw new Error("Packaged Shift document type does not use the macOS system icon compositor");
  }
  if (exportedType?.UTTypeIcons?.UTTypeIconBadgeName !== macosDocumentBadgeName) {
    throw new Error("Packaged Shift document type does not reference its document badge");
  }
  if (exportedType?.UTTypeIcons?.UTTypeIconText !== "SHIFT") {
    throw new Error("Packaged Shift document type does not include its icon label");
  }
  if (!assets.some(({ Name }) => Name === macosDocumentBadgeName)) {
    throw new Error("Packaged asset catalog does not contain the Shift document badge");
  }

  const expectedDocumentRank = distribution === "nightly" ? "Alternate" : "Owner";
  if (documentType?.LSHandlerRank !== expectedDocumentRank) {
    throw new Error(`Packaged Shift document type must use ${expectedDocumentRank} handler rank`);
  }

  for (const extension of macosSourceFontExtensions) {
    const sourceType = info.CFBundleDocumentTypes?.find(({ CFBundleTypeExtensions }) =>
      CFBundleTypeExtensions?.includes(extension),
    );
    if (!sourceType) {
      throw new Error(`Packaged app does not declare the .${extension} source-font association`);
    }
    if (sourceType.CFBundleTypeRole !== "Viewer" || sourceType.LSHandlerRank !== "Alternate") {
      throw new Error(`Packaged .${extension} association must be an alternate viewer`);
    }
  }

  const binaryFontType = info.CFBundleDocumentTypes?.find(({ CFBundleTypeExtensions }) =>
    CFBundleTypeExtensions?.includes("ttf"),
  );
  for (const contentType of ["public.truetype-ttf-font", "public.opentype-font"]) {
    if (!binaryFontType?.LSItemContentTypes?.includes(contentType)) {
      throw new Error(`Packaged binary-font association does not include ${contentType}`);
    }
  }

  const sourcePackageType = info.CFBundleDocumentTypes?.find(({ CFBundleTypeExtensions }) =>
    CFBundleTypeExtensions?.includes("ufo"),
  );
  if (sourcePackageType?.LSTypeIsPackage !== true) {
    throw new Error("Packaged UFO and Glyphspackage associations must be document packages");
  }
}

verifyMacosDocumentIcon();

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a debug port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForDebugEndpoint(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited with code ${child.exitCode}\n${output.join("")}`);
    }

    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
    } catch {
      // The endpoint is expected to refuse connections during startup.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for the packaged app\n${output.join("")}`);
}

async function waitForRendererPage(browser, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    if (page) return page;

    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited with code ${child.exitCode}\n${output.join("")}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for the packaged renderer page\n${output.join("")}`);
}

const testRoot = await mkdtemp(path.join(os.tmpdir(), "shift-packaged-smoke-"));
const userDataPath = path.join(testRoot, "user-data");
const port = await reservePort();
const debugUrl = `http://127.0.0.1:${port}`;
const output = [];
const child = spawn(
  executablePath,
  [`--user-data-dir=${userDataPath}`, `--remote-debugging-port=${port}`],
  {
    detached: process.platform !== "win32",
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

let browser;
try {
  await waitForDebugEndpoint(debugUrl, child, output);
  browser = await chromium.connectOverCDP(debugUrl);

  const page = await waitForRendererPage(browser, child, output);

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.getByRole("button", { name: "New font" }).waitFor({ timeout: 30_000 });

  const rendererPath = "/.vite/renderer/main_window/index.html";
  if (!page.url().includes(rendererPath)) {
    throw new Error(`Packaged renderer loaded from an unexpected URL: ${page.url()}`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`Packaged renderer raised an error: ${pageErrors[0]?.stack ?? pageErrors[0]}`);
  }

  const startupOutput = output.join("");
  if (
    /A JavaScript error occurred|Uncaught Exception|Cannot find module|ERR_MODULE_NOT_FOUND/.test(
      startupOutput,
    )
  ) {
    throw new Error(`Packaged app reported a startup error\n${startupOutput}`);
  }

  console.log(`Packaged app rendered its landing page: ${executablePath}`);
} finally {
  try {
    await browser?.close();
  } catch (error) {
    console.warn("Packaged smoke browser cleanup failed", error);
  }

  try {
    switch (process.platform) {
      case "win32":
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        break;
      default:
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        break;
    }
  } catch (error) {
    if (error.code !== "ESRCH") console.warn("Packaged smoke process cleanup failed", error);
  }

  await waitForExit(child);
  try {
    await rm(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.warn(`Packaged smoke profile cleanup failed: ${testRoot}`, error);
  }
}
