import path from "node:path";

const CONVERTIBLE_PREVIEW_EXTENSIONS = new Set([
  ".designspace",
  ".glyphs",
  ".glyphspackage",
  ".ufo",
]);

/** Returns whether a read-only preview can become a canonical Shift document. */
export function isConvertiblePreviewPath(sourcePath: string): boolean {
  return CONVERTIBLE_PREVIEW_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
}
