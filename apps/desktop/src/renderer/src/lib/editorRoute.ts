import { asGlyphId, type GlyphId } from "@shift/types";

const EDITOR_ROUTE_PREFIX = "/editor/";

/** Returns the route that edits `glyphId`. */
export function editorPath(glyphId: GlyphId): string {
  return `${EDITOR_ROUTE_PREFIX}${encodeURIComponent(glyphId)}`;
}

/** Returns the glyph an editor route edits, or null for any other route. */
export function glyphIdFromPath(pathname: string): GlyphId | null {
  if (!pathname.startsWith(EDITOR_ROUTE_PREFIX)) return null;

  let value: string;
  try {
    value = decodeURIComponent(pathname.slice(EDITOR_ROUTE_PREFIX.length));
  } catch {
    return null;
  }

  return value.length > 0 ? asGlyphId(value) : null;
}
