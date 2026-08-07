import type { GlyphInfo } from "@shift/glyph-info";
import type { GlyphId, GlyphName } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

export function glyphCatalogItem(
  id: GlyphId,
  name: GlyphName,
  unicodes: readonly number[],
  glyphInfo: GlyphInfo,
): GlyphCatalogItem {
  const unicode = unicodes[0] ?? null;

  return {
    id,
    name,
    displayName: glyphInfo.resolveGlyphName(name, unicode),
    unicode,
  };
}
