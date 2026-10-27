import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

let editor: TestEditor;
const layer = () => editor.requireGlyphLayer();

beforeEach(async () => {
  editor = new TestEditor();
  await editor.startSession();
  editor.selectTool("pen");
  await editor.clickLocal(0, 0);
  await editor.dragLocal({
    down: { x: 200, y: 0 },
    start: { x: 200, y: -40 },
    end: { x: 200, y: -100 },
  });
});
afterEach(() => editor.destroy());

describe("GlyphLayer.deletePoints", () => {
  it("publishes the same complete topology locally and after the workspace echo", async () => {
    const selected = layer().splitSegment(layer().contours[0].segments()[0].id, 0.4)!;
    await editor.settle();
    layer().deletePoints([selected]);
    const local = layer().state;
    expect(layer().contours[0].segments()).toHaveLength(1);
    expect(layer().point(selected)).toBeNull();
    await editor.settle();
    expect(layer().state).toEqual(local);
  });
});
