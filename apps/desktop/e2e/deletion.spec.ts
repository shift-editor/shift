import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { clickApplicationMenuItem } from "./fixtures/documentLifecycle";
import { openScratchGlyph } from "./fixtures/scratchGlyph";

// Deletion topology and persistence are owned by DeletionTopology.test.ts, Deletion.test.ts,
// and FreshReopen.test.ts; key-to-mode mapping by KeyboardRouter.test.ts. These tests keep
// the real keyboard and native menu routes into fitted, gap, and handle deletion.
test.beforeEach(async ({ page, editor }) => {
  await openScratchGlyph(page, editor, "deletionWave", [
    {
      closed: false,
      points: [
        { x: 100, y: 300, pointType: "onCurve", smooth: false },
        { x: 150, y: 200, pointType: "offCurve", smooth: false },
        { x: 200, y: 150, pointType: "offCurve", smooth: false },
        { x: 300, y: 150, pointType: "onCurve", smooth: true },
        { x: 400, y: 150, pointType: "offCurve", smooth: false },
        { x: 450, y: 100, pointType: "offCurve", smooth: false },
        { x: 550, y: 100, pointType: "onCurve", smooth: true },
        { x: 650, y: 100, pointType: "offCurve", smooth: false },
        { x: 700, y: 150, pointType: "offCurve", smooth: false },
        { x: 800, y: 150, pointType: "onCurve", smooth: true },
        { x: 900, y: 150, pointType: "offCurve", smooth: false },
        { x: 950, y: 200, pointType: "offCurve", smooth: false },
        { x: 1000, y: 300, pointType: "onCurve", smooth: false },
      ],
    },
  ]);
  await expect
    .poll(async () => (await editor.outline())[0]?.segments)
    .toEqual(["cubic", "cubic", "cubic", "cubic"]);
});

test("Delete fits a selected point and undo/redo restores the exact outline", async ({
  editor,
}) => {
  const before = await editor.outline();
  const selected = before[0].onCurvePoints[2];
  await editor.clickPoint(selected.id);

  await editor.press("Delete");
  await expect
    .poll(async () => (await editor.outline())[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  const after = await editor.outline();
  expect(after[0].points.some((point) => point.id === selected.id)).toBe(false);
  expect(after[0].onCurvePoints).toEqual(
    before[0].onCurvePoints.filter((point) => point.id !== selected.id),
  );

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});

test("Shift+Backspace leaves two open fragments with exact undo/redo", async ({ editor }) => {
  const before = await editor.outline();
  await editor.clickPoint(before[0].onCurvePoints[2].id);

  await editor.press("Shift+Backspace");
  await expect
    .poll(async () => (await editor.outline()).map((contour) => contour.segments))
    .toEqual([["cubic"], ["cubic"]]);
  const after = await editor.outline();
  expect(after.map((contour) => contour.closed)).toEqual([false, false]);
  expect(after.flatMap((contour) => contour.points)).toEqual([
    ...before[0].points.slice(0, 4),
    ...before[0].points.slice(9),
  ]);

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});

for (const key of ["Backspace", "Shift+Delete"]) {
  test(`${key} on a cubic handle removes both controls without changing the next curve`, async ({
    editor,
  }) => {
    const before = await editor.outline();
    await editor.clickPoint(before[0].points[1].id);

    await editor.press(key);

    await expect
      .poll(async () => (await editor.outline())[0].segments)
      .toEqual(["line", "cubic", "cubic", "cubic"]);
    expect((await editor.outline())[0].points).toEqual([
      before[0].points[0],
      ...before[0].points.slice(3),
    ]);
  });
}

test("native Delete uses fitted deletion rather than raw point removal", async ({
  page,
  editor,
  electronApp,
}) => {
  const before = await editor.outline();
  const selected = before[0].onCurvePoints[2];
  await editor.clickPoint(selected.id);

  await clickApplicationMenuItem(page, electronApp, "edit.deleteSelection");

  await expect
    .poll(async () => (await editor.outline())[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  expect((await editor.outline())[0].points.some((point) => point.id === selected.id)).toBe(false);
});
