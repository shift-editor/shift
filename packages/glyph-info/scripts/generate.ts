import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateGlyph } from "./generators/glyphData.js";
import { generateDecomposition } from "./generators/decomposition.js";
import { generateCharsets } from "./generators/charsets.js";
import { generateLanguages } from "./generators/languages.js";
import { generateSearchIndex } from "./generators/search.js";
import { generateSkeletons } from "./generators/skeletons.js";
import { generateUnicode } from "./generators/unicode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, "..", "resources");
const GLYPHS_INFO_DIR = join(__dirname, "..", "vendor", "GlyphsInfo");
const HYPERGLOT_DIR = join(__dirname, "..", "vendor", "Hyperglot");
const UNICODE_DIR = join(__dirname, "..", "vendor", "unicode");

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
  const xmlPath = join(GLYPHS_INFO_DIR, "GlyphData.xml");
  const glyphCount = generateGlyph(xmlPath, glyphDataPath);
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

  // Step 4: languages.json
  const languagesPath = join(RESOURCES_DIR, "languages.json");
  const languageCount = generateLanguages(HYPERGLOT_DIR, UNICODE_DIR, languagesPath);
  console.log(`  languages.json: ${languageCount} languages (${formatSize(languagesPath)})`);

  // Step 5: skeletons.json
  const skeletonsPath = join(RESOURCES_DIR, "skeletons.json");
  const skeletonCount = generateSkeletons(join(UNICODE_DIR, "ArabicShaping.txt"), skeletonsPath);
  console.log(`  skeletons.json: ${skeletonCount} letters (${formatSize(skeletonsPath)})`);

  // Step 6: unicode.json
  const unicodePath = join(RESOURCES_DIR, "unicode.json");
  const unicodeCounts = generateUnicode(UNICODE_DIR, unicodePath);
  console.log(`  unicode.json: ${JSON.stringify(unicodeCounts)} (${formatSize(unicodePath)})`);

  // Step 7: search-data.json (depends on glyph-data.json)
  const searchDataPath = join(RESOURCES_DIR, "search-data.json");
  const searchCount = generateSearchIndex(glyphDataPath, searchDataPath);
  console.log(`  search-data.json: ${searchCount} entries (${formatSize(searchDataPath)})`);

  console.log("\nDone!");
}

generate();
