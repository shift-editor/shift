import { createContext, useContext } from "react";
import type { GlyphCatalogSource } from "@/types/glyphCatalog";

export const GlyphCatalogContext = createContext<GlyphCatalogSource | null>(null);

/**
 * The glyph the editor route has opened, kept apart from the catalog context.
 *
 * @remarks
 * The catalog context value changes whenever the catalog's axis location does,
 * which is every step of a weight scrub. The editor only needs the opened glyph,
 * so reading it here keeps the whole editor layout from re-rendering with the catalog.
 */
export const OpenedGlyphContext = createContext<GlyphCatalogSource["openedGlyph"]>(null);

/** Returns the glyph the editor route has opened, or null while none is open. */
export const useOpenedGlyph = (): GlyphCatalogSource["openedGlyph"] =>
  useContext(OpenedGlyphContext);

export const useGlyphCatalog = (): GlyphCatalogSource => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx) throw new Error("useGlyphCatalog must be used within a GlyphCatalogProvider");
  return ctx;
};
