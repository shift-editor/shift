import { spawnSync } from "node:child_process";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const declarations = join(packageRoot, ".dts-build");
const dist = join(packageRoot, "dist");
// Without --update-api, a changed public surface fails the build until the report is updated.
const apiExtractorMode = process.argv.includes("--update-api") ? ["--local"] : [];

try {
  run("pnpm", ["exec", "tsdown"]);
  runNodeScript("check-runtime-graph.mjs");
  runNodeScript("check-node-imports.mjs");
  run("pnpm", ["exec", "tsdown", "--config", "tsdown.dts.config.ts"]);

  for (const name of await readdir(declarations)) {
    if (name.endsWith(".d.ts")) {
      await copyFile(join(declarations, name), join(dist, name));
    }
  }
  for (const config of ["api-extractor.json", "api-extractor.ui.json"]) {
    run("pnpm", ["exec", "api-extractor", "run", "--config", config, ...apiExtractorMode]);
  }

  run("pnpm", ["exec", "vite", "build", "--config", "vite.style.config.ts"]);
  await scopeTailwindPropertyFallbacks(join(dist, "style.css"));
  runNodeScript("check-style-assets.mjs");
} finally {
  await rm(declarations, { recursive: true, force: true });
  await rm(join(packageRoot, ".api-temp"), { recursive: true, force: true });
  for (const loader of ["style-loader.js", "fonts-loader.js"]) {
    await rm(join(dist, loader), { force: true });
    await rm(join(dist, `${loader}.map`), { force: true });
  }
}

/**
 * Tailwind resets its `--tw-*` variables on every element in browsers without
 * `@property`. Scope that reset to the editor so it never touches host elements.
 */
async function scopeTailwindPropertyFallbacks(stylePath) {
  const globalReset = "*,:before,:after,::backdrop{--tw-";
  const style = await readFile(stylePath, "utf8");
  if (!style.includes(globalReset)) {
    throw new Error("Tailwind property fallback reset not found; update the SDK style scoping");
  }
  const scopedReset =
    ".shift-editor-chrome,.shift-editor-chrome *,.shift-editor-chrome :before,.shift-editor-chrome :after,.shift-editor-chrome ::backdrop{--tw-";
  await writeFile(stylePath, style.replaceAll(globalReset, scopedReset));
}

function runNodeScript(name) {
  run(process.execPath, [join(packageRoot, "scripts", name)]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}
