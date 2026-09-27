import { readdir, readFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const files = (await readdir(dist)).filter((name) => name.endsWith(".js"));
const sources = new Map(
  await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, dist), "utf8")])),
);

/** Returns the single file defining `pattern`, failing when the runtime is duplicated or missing. */
function definingFile(label, pattern) {
  const matches = files.filter((name) => pattern.test(sources.get(name)));
  if (matches.length !== 1) {
    throw new Error(
      `${label} must be defined in exactly one SDK file, found: ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

const signalsFile = definingFile("The signal runtime", /^function signal\(/m);
definingFile("The Editor class", /^(?:var Editor = class|class Editor\b)/m);

for (const entry of ["index.js", "ui.js"]) {
  const source = sources.get(entry);
  if (entry !== signalsFile && !source.includes(`from "./${signalsFile}"`)) {
    throw new Error(`${entry} must import the shared signal runtime from ${signalsFile}`);
  }
}

const ui = sources.get("ui.js");
if (ui.includes("node_modules/react/cjs") || ui.includes('__require("react")')) {
  throw new Error("SDK UI must use the consumer's React instance");
}

console.log(`Verified shared SDK runtime graph (${signalsFile})`);
