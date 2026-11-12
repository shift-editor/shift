import glyphData from "../resources/glyph-data.json";
import charsets from "../resources/charsets.json";
import languages from "../resources/languages.json";
import skeletons from "../resources/skeletons.json";
import type { GlyphInfoCoreResources } from "./types.js";

export const coreResources: GlyphInfoCoreResources = {
  glyphData,
  charsets,
  languages: languages.languages,
  skeletons: skeletons.skeletons,
};
