import { createContext, useContext } from "react";
import type { GlyphCatalogSource } from "@/types/glyphCatalog";

export const GlyphCatalogContext = createContext<GlyphCatalogSource | null>(null);

export const useGlyphCatalog = (): GlyphCatalogSource => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx) throw new Error("useGlyphCatalog must be used within a GlyphCatalogProvider");
  return ctx;
};
