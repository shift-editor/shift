import { asGlyphId, type GlyphId } from "@shift/types";

export function glyphIdFromPath(pathname: string): GlyphId | null {
  const prefix = "/editor/";
  if (!pathname.startsWith(prefix)) return null;

  let value: string;
  try {
    value = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }

  return value.length > 0 ? asGlyphId(value) : null;
}
