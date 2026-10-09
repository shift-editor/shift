import { coreResources, GlyphInfo } from "@shift/glyph-info";

let glyphInfo: GlyphInfo | null = null;
let componentResources: Promise<void> | null = null;

/**
 * Returns the shared glyph reference data, built from the core resources.
 *
 * @remarks
 * Decomposition and search data (about 10 MB of JSON) are left out of startup;
 * {@link loadComponentGlyphInfo} adds them when the component picker needs them.
 */
export function getGlyphInfo(): GlyphInfo {
  glyphInfo ??= new GlyphInfo(coreResources);
  return glyphInfo;
}

/** Loads decomposition and search data once; resolves when they are in place. */
export function loadComponentGlyphInfo(): Promise<void> {
  componentResources ??= import("@shift/glyph-info/component-resources").then((module) => {
    getGlyphInfo().addResources(module.componentResources);
  });
  return componentResources;
}
