import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateGlyphData } from "./generators/glyphData.js";
import { generateDecomposition } from "./generators/decomposition.js";
import { generateCharsets } from "./generators/charsets.js";
import { generateSearchIndex } from "./generators/search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, "..", "resources");
const VENDOR_DIR = join(__dirname, "..", "vendor", "GlyphsInfo");

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function formatSize(path: string): string {
  const size = statSync(path).size;
  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

function generate() {
  ensureDir(RESOURCES_DIR);

  console.log("Generating @shift/glyph-info resources...\n");

  // Step 1: glyph-data.json
  const glyphDataPath = join(RESOURCES_DIR, "glyph-data.json");
  const xmlPath = join(VENDOR_DIR, "GlyphData.xml");
  const glyphCount = generateGlyphData(xmlPath, glyphDataPath);
  console.log(`  glyph-data.json: ${glyphCount} entries (${formatSize(glyphDataPath)})`);

  // Step 2: decomposition.json
  const decompositionPath = join(RESOURCES_DIR, "decomposition.json");
  const { decomposedCount, usedByCount } = generateDecomposition(decompositionPath);
  console.log(
    `  decomposition.json: ${decomposedCount} decomposed, ${usedByCount} usedBy (${formatSize(decompositionPath)})`,
  );

  // Step 3: charsets.json
  const charsetsPath = join(RESOURCES_DIR, "charsets.json");
  const charsetCount = generateCharsets(charsetsPath);
  console.log(`  charsets.json: ${charsetCount} charsets (${formatSize(charsetsPath)})`);

  // Step 4: search-data.json (depends on glyph-data.json)
  const searchDataPath = join(RESOURCES_DIR, "search-data.json");
  const searchCount = generateSearchIndex(glyphDataPath, searchDataPath);
  console.log(`  search-data.json: ${searchCount} entries (${formatSize(searchDataPath)})`);

  console.log("\nDone!");
}

generate();
