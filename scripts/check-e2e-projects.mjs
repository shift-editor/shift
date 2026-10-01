/**
 * Verifies that every desktop E2E spec runs in a Playwright project and that golden captures
 * go through the shared snapshot helpers.
 *
 * Usage: node scripts/check-e2e-projects.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = path.join(repositoryRoot, "apps", "desktop");
const e2eRoot = path.join(desktopRoot, "e2e");
const snapshotHelper = path.join("fixtures", "snapshots.ts");
const playwrightCli = createRequire(path.join(desktopRoot, "package.json")).resolve(
  "@playwright/test/cli",
);

const problems = [...unassignedSpecs(), ...goldensOutsideHelper()];
if (problems.length > 0) {
  for (const problem of problems) console.error(`check-e2e-projects: ${problem}`);
  process.exitCode = 1;
} else {
  console.info(
    "check-e2e-projects: every spec runs in a project; goldens use fixtures/snapshots.ts",
  );
}

function unassignedSpecs() {
  const listed = spawnSync(process.execPath, [playwrightCli, "test", "--list", "--reporter=json"], {
    cwd: desktopRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) return [`playwright --list failed:\n${listed.stderr}`];

  const projectsByFile = new Map();
  const visit = (suite, file) => {
    const suiteFile = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const result of spec.tests) {
        const projects = projectsByFile.get(suiteFile) ?? new Set();
        projects.add(result.projectName);
        projectsByFile.set(suiteFile, projects);
      }
    }
    for (const child of suite.suites ?? []) visit(child, suiteFile);
  };
  for (const suite of JSON.parse(listed.stdout).suites) visit(suite, suite.file);

  return specFiles()
    .filter((file) => !projectsByFile.has(file))
    .map((file) => `${file} is not matched by any Playwright project`);
}

function goldensOutsideHelper() {
  return [...specFiles(), ...fixtureFiles()]
    .filter((file) => file !== snapshotHelper)
    .filter((file) => /\.toHaveScreenshot\(|\.toMatchSnapshot\(/.test(read(file)))
    .map((file) => `${file} asserts a golden directly; use fixtures/snapshots.ts`);
}

function specFiles() {
  return fs.readdirSync(e2eRoot).filter((file) => file.endsWith(".spec.ts"));
}

function fixtureFiles() {
  return fs
    .readdirSync(path.join(e2eRoot, "fixtures"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.join("fixtures", file));
}

function read(file) {
  return fs.readFileSync(path.join(e2eRoot, file), "utf8");
}
