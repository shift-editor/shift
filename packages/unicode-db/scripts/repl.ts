import { start } from "node:repl";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UnicodeDB } from "../src/UnicodeDB.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "resources", "unicode.db");

const db = new UnicodeDB(DB_PATH);

console.log("UnicodeDB REPL — `db` is ready to use");
console.log('Try: db.getByChar("A")');
console.log("     db.listBlocks()");
console.log('     db.searchByName("SMILE")');
console.log();

const r = start({ prompt: "> " });
r.context.db = db;
r.on("exit", () => {
  db.close();
  process.exit(0);
});
