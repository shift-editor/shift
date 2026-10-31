import { spawnSync } from "node:child_process";
import { access, copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const declarations = join(packageRoot, ".dts-build");
const dist = join(packageRoot, "dist");
// Without --update-api, a changed public surface fails the build until the report is updated.
const apiExtractorMode = process.argv.includes("--update-api") ? ["--local"] : [];

try {
  run("pnpm", ["exec", "tsdown"]);
  await checkRuntimeGraph();
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
  await checkStyles();
} finally {
  await rm(declarations, { recursive: true, force: true });
  await rm(join(packageRoot, ".api-temp"), { recursive: true, force: true });
  for (const loader of ["style-loader.js", "fonts-loader.js"]) {
    await rm(join(dist, loader), { force: true });
    await rm(join(dist, `${loader}.map`), { force: true });
  }
}

/**
 * Fails when the root and `/ui` entries could observe different runtimes.
 *
 * Two copies of the signal runtime or the Editor class would let UI
 * subscriptions silently miss changes made through the root entry.
 */
async function checkRuntimeGraph() {
  const files = (await readdir(dist)).filter((name) => name.endsWith(".js"));
  const sources = new Map(
    await Promise.all(files.map(async (name) => [name, await readFile(join(dist, name), "utf8")])),
  );
  const definingFile = (label, pattern) => {
    const matches = files.filter((name) => pattern.test(sources.get(name)));
    if (matches.length !== 1) {
      throw new Error(
        `${label} must be defined in exactly one SDK file, found: ${matches.join(", ")}`,
      );
    }
    return matches[0];
  };

  const signalsFile = definingFile("The signal runtime", /^function signal\(/m);
  definingFile("The Editor class", /^(?:var Editor = class|class Editor\b)/m);

  for (const entry of ["index.js", "ui.js"]) {
    if (entry !== signalsFile && !sources.get(entry).includes(`from "./${signalsFile}"`)) {
      throw new Error(`${entry} must import the shared signal runtime from ${signalsFile}`);
    }
  }

  const ui = sources.get("ui.js");
  if (ui.includes("node_modules/react/cjs") || ui.includes('__require("react")')) {
    throw new Error("SDK UI must use the consumer's React instance");
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

/** Enforces the styling contract: scoped rules, `--shift-*` tokens, and opt-in relative fonts. */
async function checkStyles() {
  const stylePath = join(dist, "style.css");
  const fontsPath = join(dist, "fonts.css");
  const [style, fonts] = await Promise.all([
    readFile(stylePath, "utf8"),
    readFile(fontsPath, "utf8"),
  ]);

  if (style.includes("@font-face"))
    throw new Error("style.css must not register fonts; use fonts.css");
  if (/(^|[},])\*,:before,:after,::backdrop\{/.test(style)) {
    throw new Error("style.css contains an unscoped universal Tailwind reset");
  }
  if (/var\(--(?:color|spacing|radius|text)-?[a-z0-9-]*[,)]/.test(style)) {
    throw new Error("style.css reads an unprefixed theme variable a host could override");
  }

  const urls = [...fonts.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)].map((match) => match[1]);
  if (urls.length === 0) throw new Error("fonts.css does not reference any packaged font assets");
  for (const url of urls) {
    if (/^(?:data:|https?:)/.test(url)) continue;
    if (url.startsWith("/")) throw new Error(`fonts.css contains an absolute asset URL: ${url}`);
    await access(resolve(dirname(fontsPath), url));
  }
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
