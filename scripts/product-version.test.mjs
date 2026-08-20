import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("./product-version.mjs", import.meta.url));

async function createProduct(version, desktopVersion = version) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-product-version-"));
  const desktopRoot = path.join(root, "apps", "desktop");
  await mkdir(desktopRoot, { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  await writeFile(
    path.join(desktopRoot, "package.json"),
    `${JSON.stringify({ version: desktopVersion }, null, 2)}\n`,
  );

  return root;
}

async function runVersionScript(root, ...arguments_) {
  return execFileAsync(process.execPath, [scriptPath, ...arguments_], { cwd: root });
}

test("accepts matching numeric product versions", async (context) => {
  const root = await createProduct("0.1.0");
  context.after(() => rm(root, { recursive: true, force: true }));

  const { stdout } = await runVersionScript(root, "check", "0.1.0");

  assert.equal(stdout.trim(), "0.1.0");
});

test("rejects product version disagreement", async (context) => {
  const root = await createProduct("0.1.0", "0.1.1");
  context.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    runVersionScript(root, "check"),
    /Product versions disagree: package\.json=0\.1\.0, apps\/desktop\/package\.json=0\.1\.1/,
  );
});

test("sets every product version", async (context) => {
  const root = await createProduct("0.1.0");
  context.after(() => rm(root, { recursive: true, force: true }));

  await runVersionScript(root, "set", "0.321.2");

  const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const desktopPackage = JSON.parse(
    await readFile(path.join(root, "apps", "desktop", "package.json"), "utf8"),
  );
  assert.equal(rootPackage.version, "0.321.2");
  assert.equal(desktopPackage.version, "0.321.2");
});

test("rejects prerelease and incomplete versions", async (context) => {
  const root = await createProduct("0.1.0");
  context.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    runVersionScript(root, "set", "0.1.0-alpha.1"),
    /Invalid numeric product version/,
  );
  await assert.rejects(runVersionScript(root, "set", "0.1"), /Invalid numeric product version/);
});
