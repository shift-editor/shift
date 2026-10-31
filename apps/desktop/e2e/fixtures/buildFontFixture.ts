import type { ElectronApplication, Page } from "@playwright/test";
import { buildFont, type FontBuilder, type FontFixture } from "@/testing/fonts";
import { EditorDriver } from "./EditorDriver";

/** Builds `font` into the workspace open in `page`, as vitest's `useTestEditor(font)` does. */
export async function buildFontFixture(
  page: Page,
  app: ElectronApplication,
  font: FontFixture,
): Promise<void> {
  await buildFont(fontBuilder(new EditorDriver(page, app)), font);
}

/**
 * The driver as {@link buildFont} needs it: the vitest surface's `openGlyph(name)` is the
 * driver's `openGlyphByName`, since the driver's own `openGlyph` takes a glyph id.
 */
function fontBuilder(driver: EditorDriver): FontBuilder {
  return {
    glyphNamed: (name) => driver.glyphNamed(name),
    addGlyph: (name, unicode) => driver.addGlyph(name, unicode),
    openGlyph: (name) => driver.openGlyphByName(name),
    draw: driver.draw.bind(driver),
    addAxis: (axis) => driver.addAxis(axis),
    addSource: (name, location) => driver.addSource(name, location),
    setSourceMetric: (source, metric, position) => driver.setSourceMetric(source, metric, position),
    addInstance: (name, location) => driver.addInstance(name, location),
    setLocation: (location) => driver.setLocation(location),
  };
}
