import glyphData from "../resources/glyph-data.json";
import decomposition from "../resources/decomposition.json";
import charsets from "../resources/charsets.json";
import languages from "../resources/languages.json";
import searchData from "../resources/search-data.json";
import type { GlyphInfoResources } from "./types.js";

export const defaultResources: GlyphInfoResources = {
  glyphData,
  decomposition,
  charsets,
  languages: languages.languages,
  searchData,
};
