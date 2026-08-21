const CONVERTIBLE_PREVIEW_EXTENSIONS = new Set([
  ".designspace",
  ".glyphs",
  ".glyphspackage",
  ".ufo",
]);

/** Returns whether a read-only preview can become a canonical Shift document. */
export function isConvertiblePreviewPath(sourcePath: string): boolean {
  const separatorIndex = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
  const extensionIndex = sourcePath.lastIndexOf(".");
  if (extensionIndex <= separatorIndex + 1) return false;

  return CONVERTIBLE_PREVIEW_EXTENSIONS.has(sourcePath.slice(extensionIndex).toLowerCase());
}
