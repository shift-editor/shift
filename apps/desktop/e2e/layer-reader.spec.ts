import { documentWorkspaceTest as test, expect } from "./fixtures/electronApp";
import { readFirstLayerThroughPreload } from "./fixtures/documentLifecycle";

test("the window reads the open document's layers through its preload", async ({ page }) => {
  const read = await readFirstLayerThroughPreload(page);

  expect(read.kind).toBe("document");
  expect(read.bytes).toContain(read.layerId);
  expect(read.closure).toContain(read.glyphId);
});
