import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.join(packageRoot, ".code-api");
const bundledPath = path.join(temporaryRoot, "capabilities.d.ts");
const formattedPath = path.join(temporaryRoot, "code-api.d.ts");
const outputPath = path.join(packageRoot, "generated", "code-api.d.ts");

try {
  run("pnpm", ["exec", "tsdown", "--config", "tsdown.config.ts"]);
  const declarations = await readFile(bundledPath, "utf8");
  const withoutSourceMap = declarations.replace(/^\/\/# sourceMappingURL=.*$/m, "").trim();
  const generated = `${withoutSourceMap}\n\ndeclare global {\n  const shift: ShiftScript;\n}\n`;

  await writeFile(formattedPath, generated);
  run("pnpm", ["exec", "oxfmt", ".code-api/code-api.d.ts"]);
  const formatted = await readFile(formattedPath, "utf8");

  if (process.argv.includes("--check")) {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== formatted) {
      console.error(
        "Generated runtime code API is stale. Run pnpm --filter @shift/runtime code-api:generate.",
      );
      process.exitCode = 1;
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, formatted);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
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
