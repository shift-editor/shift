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
const servers = [];
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
    "package/LICENSE-MIT",
    "package/LICENSE-APACHE",
    "package/THIRD_PARTY_NOTICES.md",
    "package/THIRD_PARTY_LICENSES.txt",
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
  for (const [name, fixture] of [
    ["vite", vite],
    ["next", next],
  ]) {
    await cp(join(fixturesRoot, name), fixture, { recursive: true });
    await cp(join(fixturesRoot, "shared"), join(fixture, "shared"), { recursive: true });
    run("pnpm", ["install", "--frozen-lockfile=false"], fixture);
    run("pnpm", ["build"], fixture);
  }

  const viteAssets = await readdir(join(vite, "dist/assets"));
  assert(
    viteAssets.some((name) => name.endsWith(".ttf")),
    "Vite consumer did not emit SDK font assets",
  );

  browser = await chromium.launch({ headless: true });

  const vitePort = await availablePort();
  const viteServer = startServer(
    [join(vite, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port"],
    vitePort,
    vite,
  );
  servers.push(viteServer);
  await checkViteConsumer(`http://127.0.0.1:${vitePort}`, viteServer);

  const nextPort = await availablePort();
  const nextServer = startServer(
    [
      join(vite, "node_modules/vite/bin/vite.js"),
      "preview",
      "--outDir",
      join(next, "out"),
      "--host",
      "127.0.0.1",
      "--port",
    ],
    nextPort,
    next,
  );
  servers.push(nextServer);
  await checkNextConsumer(`http://127.0.0.1:${nextPort}`, nextServer);

  console.log("Packed Vite and Next consumers built and ran successfully");
} finally {
  await browser?.close();
  for (const server of servers) server.kill("SIGTERM");
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function checkViteConsumer(url, server) {
  await waitForUrl(url, server);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => window.shiftSdkHarness.glyphPlaced(), undefined, { timeout: 10_000 })
    .catch((error) => {
      throw new Error(`glyph was not placed: ${runtimeErrors.join("\n") || error.message}`);
    });
  const canvas = page.getByLabel("Interactive font editor");
  await page.locator(".shift-editor-canvas[data-ready='true']").waitFor();

  const leftSidebearing = page.getByRole("textbox", { name: "Left sidebearing" });
  assert.match(await leftSidebearing.inputValue(), /^-?\d+$/, "sidebearing did not load");
  assert.equal(
    await leftSidebearing.isDisabled(),
    true,
    "memory sessions must not offer workspace-backed metric edits",
  );

  const toolbar = page.locator(".shift-editor-chrome header").first();
  const toolbarBackground = () =>
    toolbar.evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(
    await toolbarBackground(),
    "rgb(226, 226, 226)",
    "host theme variables leaked into the editor",
  );
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--shift-color-chrome", "rgb(1, 2, 3)"),
  );
  assert.equal(
    await toolbarBackground(),
    "rgb(1, 2, 3)",
    "--shift-* variables must theme the editor",
  );
  await page.evaluate(() => document.documentElement.style.removeProperty("--shift-color-chrome"));

  const toolLabels = await page
    .getByRole("toolbar", { name: "Editor tools" })
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  assert.deepEqual(toolLabels, ["Select Tool (V)", "Hand Tool (H)"]);

  await page.getByRole("button", { name: "Hide left sidebar" }).hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert.equal(await tooltip.textContent(), "Toggle left sidebar");
  assert.equal(
    await tooltip.evaluate((element) => element.closest(".shift-editor-chrome") !== null),
    true,
    "tooltips must mount inside the editor root",
  );
  assert.equal(
    await tooltip.evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(35, 35, 35)",
    "tooltips must receive the SDK's scoped styles",
  );
  await page.mouse.move(0, 0);

  const pointId = await page.evaluate(() => window.shiftSdkHarness.onCurvePointId());
  assert(pointId, "Inter a has no on-curve point in its Regular layer");
  const before = await page.evaluate((id) => window.shiftSdkHarness.pointPosition(id), pointId);
  const zoom = await page.evaluate(() => window.shiftSdkHarness.zoom());
  const drag = { x: 40, y: 30 };
  await dragOnCanvas(
    page,
    canvas,
    await page.evaluate((id) => window.shiftSdkHarness.pointScreenPosition(id), pointId),
    drag,
  );
  const after = await page.evaluate((id) => window.shiftSdkHarness.pointPosition(id), pointId);
  assertClose(after.x, before.x + drag.x / zoom, "Select drag x");
  assertClose(after.y, before.y - drag.y / zoom, "Select drag y");

  await page.getByRole("button", { name: "Hand Tool (H)" }).click();
  const panBefore = await page.evaluate(() => window.shiftSdkHarness.pan());
  const bounds = await canvas.boundingBox();
  await dragOnCanvas(
    page,
    canvas,
    { x: bounds.width / 2, y: bounds.height - 40 },
    { x: -60, y: -25 },
  );
  const panAfter = await page.evaluate(() => window.shiftSdkHarness.pan());
  assertClose(panAfter.x - panBefore.x, -60, "Hand pan x");
  assertClose(panAfter.y - panBefore.y, -25, "Hand pan y");
  assert.deepEqual(
    await page.evaluate((id) => window.shiftSdkHarness.pointPosition(id), pointId),
    after,
    "Hand panning must not edit geometry",
  );

  const axisInput = page.getByLabel("Weight value");
  await axisInput.click();
  await axisInput.fill("725");
  await axisInput.press("Enter");
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.firstAxis()), 725);
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.secondAxis()), 400);

  await page.getByRole("slider", { name: "Weight" }).dblclick({ force: true });
  assert.equal(await page.evaluate(() => window.shiftSdkHarness.firstAxis()), 400);

  const cameraWidths = [];
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 900, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    const canvasBounds = await canvas.boundingBox();
    await page.waitForFunction(
      ({ width, height }) => {
        const size = window.shiftSdkHarness.cameraSize();
        return Math.abs(size.width - width) < 1 && Math.abs(size.height - height) < 1;
      },
      { width: canvasBounds.width, height: canvasBounds.height },
    );
    cameraWidths.push((await page.evaluate(() => window.shiftSdkHarness.cameraSize())).width);
  }
  assert.notEqual(cameraWidths[0], cameraWidths[1], "camera did not follow the canvas size");

  assert.deepEqual(await page.evaluate(() => window.shiftSdkHarness.disposedSession()), {
    toolReleased: true,
    toolsUnregistered: true,
    secondDisposeThrew: false,
  });
  assert.deepEqual(runtimeErrors, [], "packed Vite consumer emitted runtime errors");
  await page.close();
}

async function checkNextConsumer(url, server) {
  await waitForUrl(url, server);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".shift-editor-canvas[data-ready='true']").waitFor();
  const leftSidebearing = page.getByRole("textbox", { name: "Left sidebearing" });
  assert.match(await leftSidebearing.inputValue(), /^-?\d+$/, "Next consumer did not load glyph");
  assert.deepEqual(runtimeErrors, [], "packed Next consumer emitted runtime errors");
  await page.close();
}

function collectRuntimeErrors(page) {
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
  });
  return runtimeErrors;
}

async function dragOnCanvas(page, canvas, from, delta) {
  const bounds = await canvas.boundingBox();
  assert(bounds, "editor canvas is not laid out");
  const start = { x: bounds.x + from.x, y: bounds.y + from.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
  await page.mouse.up();
}

function assertClose(actual, expected, label) {
  assert(
    Math.abs(actual - expected) <= 1,
    `${label}: expected ${expected.toFixed(2)}, received ${actual.toFixed(2)}`,
  );
}

function startServer(args, port, cwd) {
  const server = spawn(process.execPath, [...args, String(port)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.output = "";
  server.stdout.on("data", (chunk) => (server.output += chunk));
  server.stderr.on("data", (chunk) => (server.output += chunk));
  return server;
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
      throw new Error(`Server exited with status ${process.exitCode}:\n${process.output}`);
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
