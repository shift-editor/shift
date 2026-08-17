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
const executableName = distribution === "nightly" ? "shift-nightly" : "shift";

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

  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error("Packaged app did not create a renderer page");

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
