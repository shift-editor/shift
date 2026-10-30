import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { glyphProperties } from "./fixtures/appLocators";
import { openScratchGlyph, SMOOTH_JOIN_CONTOUR } from "./fixtures/scratchGlyph";

test("edits a selected cubic handle by angle and length", async ({ page, editor }) => {
  const { incoming, join, outgoing } = await openScratchGlyph(editor, "handleProperties", [
    SMOOTH_JOIN_CONTOUR,
  ]);

  const properties = glyphProperties(page);
  // The smooth on-curve point joins two cubics: its outgoing handle is the one edited, and the
  // incoming cubic's last handle is the opposite one.
  const [incomingHandle, smoothPoint, outgoingHandle] = await Promise.all(
    [incoming, join, outgoing].map((id) => editor.point(id)),
  );
  if (!incomingHandle || !smoothPoint?.smooth || !outgoingHandle) {
    throw new Error("Expected a smooth cubic handle");
  }
  const handle = {
    pointId: outgoingHandle.id,
    anchorId: smoothPoint.id,
    oppositeId: incomingHandle.id,
    anchor: { x: smoothPoint.x, y: smoothPoint.y },
    angleDegrees:
      (Math.atan2(outgoingHandle.y - smoothPoint.y, outgoingHandle.x - smoothPoint.x) * 180) /
      Math.PI,
    length: Math.hypot(outgoingHandle.x - smoothPoint.x, outgoingHandle.y - smoothPoint.y),
    oppositeLength: Math.hypot(incomingHandle.x - smoothPoint.x, incomingHandle.y - smoothPoint.y),
  };

  await editor.clickPoint(handle.pointId);
  const angleInput = properties.getByLabel("Handle angle", { exact: true });
  const lengthInput = properties.getByLabel("Handle length", { exact: true });
  await expect(properties.getByRole("heading", { name: "Handle", exact: true })).toBeVisible();
  await expect(angleInput).toBeVisible();
  await expect(lengthInput).toBeVisible();
  expect(Number.parseFloat(await angleInput.inputValue())).toBeCloseTo(handle.angleDegrees, 1);
  expect(Number.parseFloat(await lengthInput.inputValue())).toBeCloseTo(handle.length, 1);

  await editor.commitInputValue(angleInput, 45);

  const diagonal = Math.SQRT1_2;
  const angled = (await editor.point(handle.pointId))!;
  expect(angled.x).toBeCloseTo(handle.anchor.x + handle.length * diagonal);
  expect(angled.y).toBeCloseTo(handle.anchor.y + handle.length * diagonal);
  const opposite = (await editor.point(handle.oppositeId))!;
  expect(opposite.x).toBeCloseTo(handle.anchor.x - handle.oppositeLength * diagonal);
  expect(opposite.y).toBeCloseTo(handle.anchor.y - handle.oppositeLength * diagonal);

  await editor.commitInputValue(lengthInput, 50);

  const shortened = (await editor.point(handle.pointId))!;
  expect(shortened.x).toBeCloseTo(handle.anchor.x + 50 * diagonal);
  expect(shortened.y).toBeCloseTo(handle.anchor.y + 50 * diagonal);
  const oppositeAfterLength = (await editor.point(handle.oppositeId))!;
  expect(oppositeAfterLength.x).toBeCloseTo(opposite.x);
  expect(oppositeAfterLength.y).toBeCloseTo(opposite.y);

  await editor.clickPoint(handle.anchorId);
  await expect(angleInput).toHaveCount(0);
  await expect(lengthInput).toHaveCount(0);
});
