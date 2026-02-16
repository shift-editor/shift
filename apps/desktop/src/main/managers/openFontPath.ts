import path from "node:path";

const SUPPORTED_FONT_EXTENSIONS = new Set([".ufo", ".ttf", ".otf"]);

export function isSupportedFontPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_FONT_EXTENSIONS.has(ext);
}

export function normalizeFontPath(filePath: string): string | null {
  const candidate = filePath.trim();
  if (!candidate || !isSupportedFontPath(candidate)) {
    return null;
  }
  return path.normalize(candidate);
}

export function extractFirstFontPath(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg || arg.startsWith("-")) continue;
    const normalized = normalizeFontPath(arg);
    if (normalized) return normalized;
  }
  return null;
}
