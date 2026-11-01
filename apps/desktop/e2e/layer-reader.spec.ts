import { documentWorkspaceTest as test, expect, FONTS } from "./fixtures/electronApp";
import {
  readFirstLayerThroughPreload,
  readSourceGlyphThroughPreload,
} from "./fixtures/documentLifecycle";

test("the window reads the open document's layers through its preload", async ({ page }) => {
  const read = await readFirstLayerThroughPreload(page);

  expect(read.kind).toBe("document");
  expect(read.bytes).toContain(read.layerId);
  expect(read.bases).not.toContain(read.glyphId);
});

test("the window reads a UFO's glyph synchronously through its preload", async ({ page }) => {
  const read = await readSourceGlyphThroughPreload(page, FONTS.mutatorSansLightCondensed, "Aacute");

  expect(read).toEqual({
    componentNames: ["A", "acute"],
    baseNames: ["A", "acute"],
    layers: [{ id: expect.any(String), bytes: expect.stringContaining("acute") }],
  });
  for (const layer of read.layers) expect(layer.bytes).toContain(layer.id);
});
