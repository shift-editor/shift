import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import unicodeBlocks from "unicode-blocks";
import unicodeProperties from "unicode-properties";
import { unicodeName } from "unicode-name";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "resources", "unicode.db");

function findBlock(cp: number): string {
  const block = unicodeBlocks.find((b) => cp >= b.start && cp <= b.end);
  return block?.name ?? "Unknown";
}

function generate() {
  const resourcesDir = dirname(DB_PATH);
  if (!existsSync(resourcesDir)) {
    mkdirSync(resourcesDir, { recursive: true });
  }

  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE unicode (
      codepoint       INTEGER PRIMARY KEY,
      char            TEXT NOT NULL,
      name            TEXT,
      category        TEXT NOT NULL,
      script          TEXT,
      block           TEXT NOT NULL,
      combining_class TEXT
    );

    CREATE INDEX idx_category ON unicode(category);
    CREATE INDEX idx_script ON unicode(script);
    CREATE INDEX idx_block ON unicode(block);
    CREATE INDEX idx_name ON unicode(name);
  `);

  const insert = db.prepare(`
    INSERT INTO unicode (codepoint, char, name, category, script, block, combining_class)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;

  const insertAll = db.transaction(() => {
    for (let cp = 0x0000; cp <= 0xffff; cp++) {
      // Skip surrogates (0xD800–0xDFFF)
      if (cp >= 0xd800 && cp <= 0xdfff) continue;

      const char = String.fromCodePoint(cp);
      const name = unicodeName(cp) ?? null;
      const category = unicodeProperties.getCategory(cp);
      const script = unicodeProperties.getScript(cp) ?? null;
      const block = findBlock(cp);
      const combiningClass = unicodeProperties.getCombiningClass(cp) ?? null;

      insert.run(cp, char, name, category, script, block, combiningClass);
      count++;
    }
  });

  insertAll();
  db.close();

  const size = statSync(DB_PATH).size;
  const sizeMB = (size / (1024 * 1024)).toFixed(2);
  console.log(`Generated ${DB_PATH}`);
  console.log(`  Rows: ${count}`);
  console.log(`  Size: ${sizeMB} MB`);
}

generate();
