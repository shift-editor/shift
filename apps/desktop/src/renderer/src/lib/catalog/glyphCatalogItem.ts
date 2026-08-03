import type { GlyphInfo } from "@shift/glyph-info";
import type { CatalogGlyphKey } from "@/types/glyphAtlas";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

export function glyphCatalogItem(
  id: CatalogGlyphKey,
  name: string,
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
