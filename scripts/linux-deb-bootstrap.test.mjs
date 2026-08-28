import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const configUrl = pathToFileURL(
  path.join(repositoryRoot, "apps/desktop/electron-builder.config.ts"),
).href;
const repositoryDestinations = [
  "/etc/apt/keyrings/shift-repository.gpg",
  "/etc/apt/sources.list.d/shift.sources",
];

async function loadLinuxPackageConfiguration(distribution) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import importedConfig from ${JSON.stringify(configUrl)}; const config = importedConfig.default ?? importedConfig; process.stdout.write(JSON.stringify({ deb: config.deb?.fpm, rpm: config.rpm?.fpm }));`,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SHIFT_BUILD_ARCH: "x64",
        SHIFT_DISTRIBUTION: distribution,
      },
    },
  );
  return JSON.parse(stdout);
}

function assertExcludesRepositoryConfiguration(entries) {
  for (const destination of repositoryDestinations) {
    assert.ok(entries.every((entry) => !entry.includes(destination)));
  }
}

test("Release DEB bootstraps its APT repository as conffiles", async () => {
  const configuration = await loadLinuxPackageConfiguration("release");

  for (const destination of repositoryDestinations) {
    assert.ok(configuration.deb.includes(destination));
    assert.ok(configuration.deb.some((entry) => entry.endsWith(`=${destination}`)));
  }
  assert.equal(
    configuration.deb.filter((entry) => entry === "--config-files").length,
    repositoryDestinations.length,
  );
  assertExcludesRepositoryConfiguration(configuration.rpm);
});

test("Nightly Linux packages do not enroll in the Release repository", async () => {
  const configuration = await loadLinuxPackageConfiguration("nightly");

  assertExcludesRepositoryConfiguration(configuration.deb);
  assertExcludesRepositoryConfiguration(configuration.rpm);
});
