import type { PointId } from "@shift/types";
import type { OutlinePoint } from "@/testing/reads";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { openCubicPointTypes, openScratchGlyph, WAVE_CONTOUR } from "./fixtures/scratchGlyph";

async function wavePointTypes(editor: EditorDriver) {
  return (await editor.outline())[0]?.points.map((point) => point.pointType);
}

// Deletion topology and persistence are owned by DeletionTopology.test.ts, Deletion.test.ts,
// and FreshReopen.test.ts; key-to-mode mapping, gap and handle deletion by
// KeyboardRouter.test.ts. These tests keep the real keyboard route; the native menu route
// is in application-menu.spec.ts, which runs with the OS focus to itself.
let middle: PointId;

test.beforeEach(async ({ editor }) => {
  ({ middle } = await openScratchGlyph(editor, "deletionWave", [WAVE_CONTOUR]));
  await expect.poll(() => wavePointTypes(editor)).toEqual(openCubicPointTypes(4));
});

test("Delete fits a selected point and undo/redo restores the exact outline", async ({
  editor,
}) => {
  const before = await editor.outline();
  await editor.clickPoint(middle);

  await editor.press("Delete");
  await expect.poll(() => wavePointTypes(editor)).toEqual(openCubicPointTypes(3));
  const after = await editor.outline();
  expect(after).toMatchObject([
    { points: expect.not.arrayContaining([expect.objectContaining({ id: middle })]) },
  ]);
  // Every third point is on-curve (see openCubicPointTypes); the rest stay where they were, and
  // middle was the third of five.
  const onCurve = (points: readonly OutlinePoint[]) => points.filter((_, index) => index % 3 === 0);
  expect(onCurve(after[0]!.points)).toEqual(onCurve(before[0]!.points).toSpliced(2, 1));

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});
