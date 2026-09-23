import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(packageRoot, "e2e/fixtures");
const temporaryRoot = await mkdtemp(join(tmpdir(), "shift-sdk-consumers-"));
let preview;
let browser;

try {
  run("pnpm", ["pack", "--pack-destination", temporaryRoot], packageRoot);
  const archiveName = (await readdir(temporaryRoot)).find((name) => name.endsWith(".tgz"));
  assert(archiveName, "pnpm pack did not produce an archive");
  const archive = join(temporaryRoot, "shift-editor-sdk.tgz");
  await rename(join(temporaryRoot, archiveName), archive);

  const entries = output("tar", ["-tzf", archive], packageRoot).trim().split("\n");
  for (const required of [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/ui.js",
    "package/dist/ui.d.ts",
    "package/dist/style.css",
  ]) {
    assert(entries.includes(required), `packed SDK is missing ${required}`);
  }
  assert.equal(
    entries.filter((entry) => /^package\/dist\/assets\/.*\.ttf$/.test(entry)).length,
    2,
    "packed SDK must include both font assets",
  );

  const vite = join(temporaryRoot, "vite");
  const next = join(temporaryRoot, "next");
  await cp(join(fixturesRoot, "vite"), vite, { recursive: true });
  await cp(join(fixturesRoot, "next"), next, { recursive: true });

  for (const fixture of [vite, next]) {
    run("pnpm", ["install", "--frozen-lockfile=false"], fixture);
    run("pnpm", ["build"], fixture);
  }

  const viteAssets = await readdir(join(vite, "dist/assets"));
  assert(
    viteAssets.some((name) => name.endsWith(".ttf")),
    "Vite consumer did not emit SDK font assets",
  );

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  preview = spawn(
    process.execPath,
    [
      join(vite, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: vite, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitForUrl(url, preview);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.runtimeIdentity), true);

  const axisInput = page.getByLabel("Weight value");
  await axisInput.click();
  await axisInput.fill("725");
  await axisInput.press("Enter");
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.firstAxis()), 725);
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.secondAxis()), 400);

  await page.getByRole("slider", { name: "Weight" }).dblclick({ force: true });
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.firstAxis()), 400);

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 640, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const canvas = page.getByLabel("Interactive font editor");
    const bounds = await canvas.boundingBox();
    assert(bounds && bounds.width > 0 && bounds.height > 0, "editor canvas did not resize");
  }

  assert.deepEqual(await page.evaluate(() => window.shiftSdkHarness.disposalCounts()), {
    editor: 1,
    font: 1,
  });
  assert.deepEqual(runtimeErrors, [], `packed Vite consumer emitted runtime errors`);

  console.log("Packed Vite and Next consumers built and ran successfully");
} finally {
  await browser?.close();
  preview?.kill("SIGTERM");
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function output(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object", "could not allocate a preview port");
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForUrl(url, process) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Preview server exited with status ${process.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
