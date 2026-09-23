import { readFile } from "node:fs/promises";

const [indexSource, uiSource] = await Promise.all([
  readFile(new URL("../dist/index.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/ui.js", import.meta.url), "utf8"),
]);

const sharedSignalsImport = /from "(\.\/signals-[^"]+\.js)"/;
const indexSignals = indexSource.match(sharedSignalsImport)?.[1];
const uiSignals = uiSource.match(sharedSignalsImport)?.[1];

if (!indexSignals || indexSignals !== uiSignals) {
  throw new Error("SDK runtime and UI must import the same shared signals chunk");
}

if (uiSource.includes("node_modules/react/cjs") || uiSource.includes('__require("react")')) {
  throw new Error("SDK UI must use the consumer's React instance");
}

console.log(`Verified shared SDK runtime graph (${indexSignals})`);
