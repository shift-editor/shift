import type { Page } from "@playwright/test";
import type { PointId } from "@shift/types";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { test, expect, drawBenchmarkGlyph, computeStats } from "./fixtures/perfApp";
import { offsetMatchedSourcePoints } from "./fixtures/perfProbe";
import { localPoint } from "@shift/editor/spaces";

const GLYPH_POINTS = 50_000;
const PREVIEW_FRAMES = 10;

async function prepareFourSourceGlyph(
  page: Page,
  editor: EditorDriver,
  selectedPointCount: number,
): Promise<PointId[]> {
  await editor.openGlyphByUnicode("53");
  const inserted = await drawBenchmarkGlyph(editor, GLYPH_POINTS);
  if (inserted.length < selectedPointCount) throw new Error("Expected inserted points");
  const selectedPointIds = Array.from(
    { length: selectedPointCount },
    (_, index) => inserted[Math.floor((index * inserted.length) / selectedPointCount)]!,
  );
  await editor.waitForIdle();

  await editor.addAxis({
    tag: "bch1",
    name: "Benchmark Weight",
    minimum: 100,
    default: 400,
    maximum: 900,
  });
  const reference = (await editor.source("default"))!.name;
  const sources = [
    ["Benchmark Medium", 500],
    ["Benchmark Semibold", 700],
    ["Benchmark Bold", 900],
  ] as const;
  for (const [name, value] of sources) await editor.addSource(name, { bch1: value });
  await editor.editSources([reference, ...sources.map(([name]) => name)]);
  await editor.waitForIdle();
  await expect
    .poll(async () => (await editor.matchedPoints(selectedPointIds[0]!)).length, {
      timeout: 20_000,
    })
    .toBe(4);

  await offsetMatchedSourcePoints(page, selectedPointIds, 3);
  await editor.selectObjects(selectedPointIds);
  await editor.zoomToFit();
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
  const positions = async () => {
    const found = await editor.matchedPoints(pointIds[0]!);
    if (found.length !== 4) throw new Error("Expected four editable source layers");
    return found.map(({ x, y }) => ({ x, y }));
  };

  const before = await positions();
  const bounds = await editor.selectionBounds();
  // Grab the upper-right corner: the floating tools dock to the canvas's bottom edge and cover
  // the lower corners of a zoomed-to-fit selection. Glyph y points up, so `bottom` is the top.
  const upperRight = await editor.projectGlyphToPage(localPoint(bounds.right, bounds.bottom));
  const from = operation === "scale" ? upperRight : { x: upperRight.x + 8, y: upperRight.y - 8 };
  const state = operation === "scale" ? "resizing" : "rotating";
  const occludedByFloatingUi = await page
    .locator(":root")
    .evaluate(
      (_root, { x, y }) =>
        Boolean(document.elementFromPoint(x, y)?.closest("[data-floating-toolbar]")),
      from,
    );
  expect(occludedByFloatingUi, "transform handle is not under the floating tools").toBe(false);
  await editor.pointerDown(from);
  await editor.pointerMove({ x: from.x + 12, y: from.y - 6 });
  await expect.poll(() => editor.toolState()).toBe(state);

  const previewTimes: number[] = [];
  for (let index = 0; index < PREVIEW_FRAMES; index++) {
    const start = performance.now();
    await editor.pointerMove({ x: from.x + 16 + index * 4, y: from.y - 8 - index * 3 });
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
