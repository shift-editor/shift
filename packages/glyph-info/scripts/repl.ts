import { readFileSync } from "node:fs";
import { start } from "node:repl";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlyphInfo } from "../src/GlyphInfo.js";
import type { GlyphInfoResources } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourcesDir = join(__dirname, "..", "resources");

const resources: GlyphInfoResources = {
  glyphData: JSON.parse(readFileSync(join(resourcesDir, "glyph-data.json"), "utf-8")),
  decomposition: JSON.parse(readFileSync(join(resourcesDir, "decomposition.json"), "utf-8")),
  charsets: JSON.parse(readFileSync(join(resourcesDir, "charsets.json"), "utf-8")),
  searchData: JSON.parse(readFileSync(join(resourcesDir, "search-data.json"), "utf-8")),
};

const db = new GlyphInfo(resources);

console.log("GlyphInfo REPL — `db` is ready to use");
console.log("Try: db.getGlyphName(0x24)");
console.log("     db.getGlyphData(0x41)");
console.log("     db.getDecomposition(0xE9)");
console.log('     db.search("dollar")');
console.log("     db.listCharsets()");
console.log();

const r = start({ prompt: "> " });
r.context.db = db;
r.on("exit", () => {
  db.close();
  process.exit(0);
});
