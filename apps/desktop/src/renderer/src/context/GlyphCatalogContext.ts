import { createContext, useContext } from "react";
import type { GlyphCatalogState } from "@/types/glyphCatalog";

export const GlyphCatalogContext = createContext<GlyphCatalogState | null>(null);

export const useGlyphCatalog = (): GlyphCatalogState => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx) throw new Error("useGlyphCatalog must be used within a GlyphCatalogProvider");
  return ctx;
};
