import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { glyphProperties } from "./fixtures/appLocators";

test("edits a selected cubic handle by angle and length", async ({ page, editor }) => {
  await editor.openGlyphByUnicode("4f");
  const properties = glyphProperties(page);
  const handle = await page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;

    for (const contour of layer.contours) {
      const segments = contour.segments();
      for (const segment of segments) {
        const cubic = segment.asCubic();
        if (!cubic?.start.smooth) continue;

        const incoming = segments
          .map((candidate) => candidate.asCubic())
          .find((candidate) => candidate?.end.id === cubic.start.id);
        if (!incoming) continue;

        return {
          pointId: cubic.controlStart.id,
          anchorId: cubic.start.id,
          oppositeId: incoming.controlEnd.id,
          anchor: { x: cubic.start.x, y: cubic.start.y },
          angleDegrees:
            (Math.atan2(
              cubic.controlStart.y - cubic.start.y,
              cubic.controlStart.x - cubic.start.x,
            ) *
              180) /
            Math.PI,
          length: Math.hypot(
            cubic.controlStart.x - cubic.start.x,
            cubic.controlStart.y - cubic.start.y,
          ),
          oppositeLength: Math.hypot(
            incoming.controlEnd.x - cubic.start.x,
            incoming.controlEnd.y - cubic.start.y,
          ),
        };
      }
    }

    throw new Error("Expected a smooth cubic handle");
  });

  await editor.clickPoint(handle.pointId);
  const angleInput = properties.getByLabel("Handle angle", { exact: true });
  const lengthInput = properties.getByLabel("Handle length", { exact: true });
  await expect(properties.getByRole("heading", { name: "Handle", exact: true })).toBeVisible();
  await expect(angleInput).toBeVisible();
  await expect(lengthInput).toBeVisible();
  expect(Number.parseFloat(await angleInput.inputValue())).toBeCloseTo(handle.angleDegrees, 1);
  expect(Number.parseFloat(await lengthInput.inputValue())).toBeCloseTo(handle.length, 1);

  await angleInput.click();
  await angleInput.fill("45");
  await angleInput.press("Enter");

  const diagonal = Math.SQRT1_2;
  const angled = await editor.pointPosition(handle.pointId);
  expect(angled.x).toBeCloseTo(handle.anchor.x + handle.length * diagonal);
  expect(angled.y).toBeCloseTo(handle.anchor.y + handle.length * diagonal);
  const opposite = await editor.pointPosition(handle.oppositeId);
  expect(opposite.x).toBeCloseTo(handle.anchor.x - handle.oppositeLength * diagonal);
  expect(opposite.y).toBeCloseTo(handle.anchor.y - handle.oppositeLength * diagonal);

  await lengthInput.click();
  await lengthInput.fill("50");
  await lengthInput.press("Enter");

  const shortened = await editor.pointPosition(handle.pointId);
  expect(shortened.x).toBeCloseTo(handle.anchor.x + 50 * diagonal);
  expect(shortened.y).toBeCloseTo(handle.anchor.y + 50 * diagonal);
  const oppositeAfterLength = await editor.pointPosition(handle.oppositeId);
  expect(oppositeAfterLength.x).toBeCloseTo(opposite.x);
  expect(oppositeAfterLength.y).toBeCloseTo(opposite.y);

  await editor.clickPoint(handle.anchorId);
  await expect(angleInput).toHaveCount(0);
  await expect(lengthInput).toHaveCount(0);
});
