import { start } from "node:repl";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlyphInfo } from "../src/GlyphInfo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, "..", "resources");

const db = new GlyphInfo(RESOURCES_DIR);

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
