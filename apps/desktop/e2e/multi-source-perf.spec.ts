import type { Page } from "@playwright/test";
import type { PointId, SourceId } from "@shift/types";
import type { ExternalAxisLocation } from "@shift/editor/types";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { test, expect, generateContourData, computeStats } from "./fixtures/perfApp";

const GLYPH_POINTS = 50_000;
const PREVIEW_FRAMES = 10;

async function prepareFourSourceGlyph(
  page: Page,
  editor: EditorDriver,
  selectedPointCount: number,
): Promise<PointId[]> {
  await editor.openGlyphByUnicode("53");
  const selectedPointIds = await page.evaluate(
    ({ contours, count }) => {
      const inserted = window.shift!.editor.insertContent({ contours });
      if (!inserted || inserted.length < count) throw new Error("Expected inserted points");
      const pointIds = inserted as PointId[];
      return Array.from(
        { length: count },
        (_, index) => pointIds[Math.floor((index * pointIds.length) / count)]!,
      );
    },
    { contours: generateContourData(GLYPH_POINTS), count: selectedPointCount },
  );
  await editor.waitForIdle();

  const axisId = await page.evaluate(() =>
    window.shift!.editor.font.createAxis({
      tag: "bch1",
      name: "Benchmark Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    }),
  );
  await editor.waitForIdle();

  const referenceId = await page.evaluate(() => window.shift!.editor.font.defaultSource.id);
  const sourceIds: SourceId[] = [];
  for (const [name, value] of [
    ["Benchmark Medium", 500],
    ["Benchmark Semibold", 700],
    ["Benchmark Bold", 900],
  ] as const) {
    const sourceId = await page.evaluate(
      ({ axisId, name, value }) => {
        const location = new Map([[axisId, value]]) as unknown as ExternalAxisLocation;
        return window.shift!.editor.font.createSource(name, location);
      },
      { axisId, name, value },
    );
    await editor.waitForIdle();
    await expect
      .poll(() => page.evaluate((id) => Boolean(window.shift!.editor.font.source(id)), sourceId))
      .toBe(true);
    sourceIds.push(sourceId);
  }

  for (const sourceId of sourceIds) {
    await page.evaluate((id) => window.shift!.editor.selectSourceForEditing(id), sourceId);
    await editor.waitForIdle();
  }
  await page.evaluate(
    ({ referenceId, sourceIds }) => {
      const runtime = window.shift!.editor;
      runtime.selectSourceForEditing(referenceId);
      for (const sourceId of sourceIds) runtime.selectSourceForEditing(sourceId, "toggle");
    },
    { referenceId, sourceIds },
  );
  await editor.waitForIdle();
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) => window.shift!.editor.positionSelection(ids)?.additionalLayers.length,
          selectedPointIds,
        ),
      { timeout: 20_000 },
    )
    .toBe(3);

  await page.evaluate((ids) => {
    const targets = window.shift!.editor.positionSelection(ids)?.additionalLayers;
    if (targets?.length !== 3) throw new Error("Expected three matched source layers");
    for (const [index, target] of targets.entries()) {
      const points = target.targets.points;
      if (points?.length !== ids.length) throw new Error("Expected a complete point match");
      target.layer.movePoints(points, { x: 40 * (index + 1), y: 25 * (index + 1) });
    }
    window.shift!.editor.selection.select(ids);
    window.shift!.editor.zoomToFit();
  }, selectedPointIds);
  await editor.waitForCanvasRender();
  expect(await editor.selectionIds()).toHaveLength(selectedPointCount);
  return selectedPointIds;
}

async function measureTransformGesture(
  page: Page,
  editor: EditorDriver,
  pointIds: readonly PointId[],
  operation: "scale" | "rotate",
  cancel: boolean,
) {
  const positions = () =>
    page.evaluate((ids) => {
      const selection = window.shift!.editor.positionSelection(ids);
      if (!selection || selection.additionalLayers.length !== 3) {
        throw new Error("Expected four editable source layers");
      }
      const groups = [selection, ...selection.additionalLayers];
      return groups.map(({ layer, targets }) => {
        const id = targets.points?.[0];
        if (!id) throw new Error("Expected a matched point in each source");
        const point = layer.point(id);
        if (!point) throw new Error("Expected editable point geometry");
        return { x: point.x, y: point.y };
      });
    }, pointIds);

  const before = await positions();
  const bounds = await editor.selectionBounds();
  const lowerRight = await editor.projectGlyphToPage({ x: bounds.right, y: bounds.top });
  const from = operation === "scale" ? lowerRight : { x: lowerRight.x + 8, y: lowerRight.y + 8 };
  const state = operation === "scale" ? "resizing" : "rotating";
  await editor.pointerDown(from);
  await editor.pointerMove({ x: from.x + 12, y: from.y + 6 });
  await expect.poll(() => editor.toolState()).toBe(state);

  const previewTimes: number[] = [];
  for (let index = 0; index < PREVIEW_FRAMES; index++) {
    const start = performance.now();
    await editor.pointerMove({ x: from.x + 16 + index * 4, y: from.y + 8 + index * 3 });
    await editor.waitForCanvasRender();
    previewTimes.push(performance.now() - start);
  }
  const preview = await positions();
  for (let index = 0; index < before.length; index++) {
    expect(preview[index]).not.toEqual(before[index]);
  }

  const finishStart = performance.now();
  let releaseMs = 0;
  let settleMs = 0;
  if (cancel) {
    await editor.cancelGesture();
  } else {
    await page.mouse.up();
    releaseMs = performance.now() - finishStart;
    await editor.waitForIdle();
    settleMs = performance.now() - finishStart - releaseMs;
  }
  await editor.waitForCanvasRender();
  const finishMs = performance.now() - finishStart;
  const renderMs = finishMs - releaseMs - settleMs;
  expect(await editor.toolState()).toBe("ready");
  expect(await positions()).toEqual(cancel ? before : preview);
  if (!cancel) {
    await editor.undo();
    expect(await positions()).toEqual(before);
  }

  return { previewTimes, finishMs, releaseMs, settleMs, renderMs };
}

for (const selectedPointCount of [1_000, 10_000, 50_000]) {
  for (const operation of ["scale", "rotate"] as const) {
    test(`${operation}s ${selectedPointCount} points across four sources with preview, cancel and undo`, async ({
      page,
      editor,
    }) => {
      const pointIds = await prepareFourSourceGlyph(page, editor, selectedPointCount);
      const canceled = await measureTransformGesture(page, editor, pointIds, operation, true);
      const committed = await measureTransformGesture(page, editor, pointIds, operation, false);
      const preview = computeStats(`${operation} (${selectedPointCount} points, four sources)`, [
        ...canceled.previewTimes,
        ...committed.previewTimes,
      ]);
      console.log(
        `${preview.label}: preview p50=${preview.p50.toFixed(1)}ms p95=${preview.p95.toFixed(1)}ms cancel=${canceled.finishMs.toFixed(1)}ms confirmed=${committed.finishMs.toFixed(1)}ms (release=${committed.releaseMs.toFixed(1)}ms settle=${committed.settleMs.toFixed(1)}ms render=${committed.renderMs.toFixed(1)}ms)`,
      );
      const maxConfirmedGestureMs = selectedPointCount === GLYPH_POINTS ? 3_000 : 1_500;
      expect(committed.finishMs, "confirmed gesture through canvas readiness").toBeLessThan(
        maxConfirmedGestureMs,
      );
    });
  }
}
