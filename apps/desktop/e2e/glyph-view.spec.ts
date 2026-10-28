import type { GlyphId } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";
import { waitForPageClock, wheelZoomThenPan } from "./fixtures/editorInteractions";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { rect } from "@/testing/fixtures";
import { screenPoint } from "@shift/editor/spaces";

/** Four glyphs: one empty, and three with a box as wide as their advance (narrow, wide, extreme). */
async function createViewGlyphs(
  editor: EditorDriver,
): Promise<readonly { id: GlyphId; name: string }[]> {
  const definitions = [
    { name: "viewEmpty", width: null },
    { name: "viewNarrow", width: 20 },
    { name: "viewWide", width: 1200 },
    { name: "viewExtreme", width: 5000 },
  ];
  const glyphs: { id: GlyphId; name: string }[] = [];
  for (const { name, width } of definitions) {
    const box = width === null ? [] : [rect(0, -100, width, 1000)];
    await editor.addGlyph(name, null);
    await editor.openGlyphByName(name);
    const { id } = (await editor.glyphNamed(name))!;
    await editor.draw({ advance: width ?? 500, contours: box });
    glyphs.push({ id, name });
  }
  return glyphs;
}

test("keeps the reported wheel position anchored across the full zoom range", async ({
  editor,
}) => {
  const glyphs = await createViewGlyphs(editor);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await editor.openGlyph(glyph.id);
  await expect(editor.canvas).toBeVisible();

  const point = (await editor.outline())[0]?.points[0];
  if (!point) throw new Error("Expected glyph point");
  const target = (await editor.pointTargets([point.id]))[0];
  if (!target) throw new Error("Expected glyph point target");
  const screen = screenPoint(
    Math.round(target.canvasPosition.x),
    Math.round(target.canvasPosition.y),
  );
  const scene = await editor.projectCanvasToScene(screen);
  const anchor = {
    screen,
    scene,
    client: await editor.projectSceneToPage(scene),
  };

  for (let index = 0; index < 60; index++) {
    await editor.canvas.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: anchor.client.x,
      clientY: anchor.client.y,
      ctrlKey: true,
      deltaMode: 0,
      deltaY: -100,
    });
  }

  await expect.poll(() => editor.zoomLevel()).toBe(32);
  const projected = await editor.projectSceneToCanvas(anchor.scene);
  expect(projected.x).toBeCloseTo(anchor.screen.x, 6);
  expect(projected.y).toBeCloseTo(anchor.screen.y, 6);
});

test("does not turn released-modifier zoom momentum into pan", async ({ page, editor }) => {
  const glyphs = await createViewGlyphs(editor);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await editor.openGlyph(glyph.id);
  await editor.waitForCanvasRender();

  const gesture = await wheelZoomThenPan(page);
  expect(gesture.momentumPan).toEqual(gesture.zoomPan);

  // Elapsed time is the contract: wait on the page clock that stamps wheel events.
  await waitForPageClock(page, gesture.zoomedAt, 250);
  const bounds = await editor.canvasBounds();
  await editor.canvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(bounds.x + bounds.width / 2),
    clientY: Math.round(bounds.y + bounds.height / 2),
    deltaMode: 0,
    deltaX: 30,
    deltaY: 0,
  });
  expect((await editor.canvasOffset()).x).toBe(gesture.zoomPan.x - 30);
});
