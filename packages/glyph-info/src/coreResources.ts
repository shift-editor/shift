import glyphData from "../resources/glyph-data.json";
import charsets from "../resources/charsets.json";
import languages from "../resources/languages.json";
import skeletons from "../resources/skeletons.json";
import unicode from "../resources/unicode.json";
import type { GlyphInfoCoreResources, UnicodeProperties } from "./types.js";

export const coreResources: GlyphInfoCoreResources = {
  glyphData,
  charsets,
  languages: languages.languages,
  skeletons: skeletons.skeletons,
  unicode: unicode as UnicodeProperties,
};
