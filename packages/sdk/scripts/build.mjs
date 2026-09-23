import { spawnSync } from "node:child_process";
import { copyFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const declarations = join(packageRoot, ".dts-build");
const dist = join(packageRoot, "dist");

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
  await copyFile(join(packageRoot, "src/ui.d.ts"), join(dist, "ui.d.ts"));

  run("pnpm", ["exec", "vite", "build", "--config", "vite.style.config.ts"]);
  runNodeScript("check-style-assets.mjs");
} finally {
  await rm(declarations, { recursive: true, force: true });
  await rm(join(dist, "style-loader.js"), { force: true });
  await rm(join(dist, "style-loader.js.map"), { force: true });
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
