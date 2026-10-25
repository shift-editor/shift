import { documentWorkspaceTest as test, expect } from "./fixtures/electronApp";

test("the window reads the open document's layers through its preload", async ({ page }) => {
  const read = await page.evaluate(async () => {
    const workspace = window.shift!;
    const location = await workspace.storeLocation();
    if (!location) throw new Error("an authored document has a layer store");
    const record = workspace.font.glyphRecords().find((glyph) => glyph.layers.length > 0);
    if (!record) throw new Error("the fixture has a glyph with a layer");
    const layerId = record.layers[0]!.id;

    const layers = window.shiftHost!.layers;
    const reader = layers.open(location);
    try {
      return {
        kind: location.kind,
        layerId,
        bytes: new TextDecoder().decode(layers.load(reader, [layerId])),
        closure: layers.componentClosure(reader, [record.id]),
        glyphId: record.id,
      };
    } finally {
      layers.close(reader);
    }
  });

  expect(read.kind).toBe("document");
  expect(read.bytes).toContain(read.layerId);
  expect(read.closure).toContain(read.glyphId);
});
