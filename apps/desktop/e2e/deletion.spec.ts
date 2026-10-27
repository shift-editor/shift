import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { openCubicPointTypes, openScratchGlyph, WAVE_CONTOUR } from "./fixtures/scratchGlyph";

async function wavePointTypes(editor: EditorDriver) {
  return (await editor.outline())[0]?.points.map((point) => point.pointType);
}

async function waveOnCurvePoints(editor: EditorDriver) {
  return (await editor.outline())[0]!.points.filter((point) => point.pointType === "onCurve");
}

// Deletion topology and persistence are owned by DeletionTopology.test.ts, Deletion.test.ts,
// and FreshReopen.test.ts; key-to-mode mapping, gap and handle deletion by
// KeyboardRouter.test.ts. These tests keep the real keyboard route; the native menu route
// is in application-menu.spec.ts, which runs with the OS focus to itself.
test.beforeEach(async ({ page, editor }) => {
  await openScratchGlyph(page, editor, "deletionWave", [WAVE_CONTOUR]);
  await expect.poll(() => wavePointTypes(editor)).toEqual(openCubicPointTypes(4));
});

test("Delete fits a selected point and undo/redo restores the exact outline", async ({
  editor,
}) => {
  const before = await editor.outline();
  const onCurveBefore = await waveOnCurvePoints(editor);
  const selected = onCurveBefore[2]!;
  await editor.clickPoint(selected.id);

  await editor.press("Delete");
  await expect.poll(() => wavePointTypes(editor)).toEqual(openCubicPointTypes(3));
  const after = await editor.outline();
  expect(after[0].points.some((point) => point.id === selected.id)).toBe(false);
  expect(await waveOnCurvePoints(editor)).toEqual(
    onCurveBefore.filter((point) => point.id !== selected.id),
  );

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});
