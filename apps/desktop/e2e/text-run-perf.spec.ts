/**
 * Frame cost of a long proof run in the real app: hovering its glyphs, and
 * dragging an anchor of the glyph edited in place.
 *
 * The run is about 10K characters of lorem in `AnchorDragBench`, with every
 * 4th letter `ǖ` and every 13th another composite on `u`, typed through the
 * Text tool's native input. Each sample is one real pointer move, then:
 *
 * - **work**: main-thread time in the animation frames that handle the move
 *   (hit testing, preview, and every render pass), without waiting for vsync.
 * - **frame**: main-thread time of the move's heaviest frame, from its first
 *   animation-frame callback until the browser has painted it and committed
 *   it to the compositor, which is where the canvas's draw calls are flushed
 *   to the GPU process. A frame over the display's interval drops a frame.
 *
 * Time until the first idle frame is not a measure here: it counts the
 * animation frames a move chains through (pointer, render, then UI updates),
 * each a whole vsync, so it barely changes between 10 and 10K characters.
 *
 * Reports go to `perf-results/` beside the other perf specs. Ceilings are
 * provisional and generous; they catch a run that stops being interactive.
 */
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { TextItemId } from "@shift/types";
import { proofText } from "../src/renderer/src/testing/proofText";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { liveUTopAnchor, textRunHoverTargets } from "./fixtures/editorInteractions";
import { installFrameProbe, measureMove } from "./fixtures/perfProbe";
import {
  anchorDragTest as test,
  computeStats,
  expect,
  formatPerfTable,
  type PerfResult,
} from "./fixtures/perfApp";

const RESULTS_DIR = path.resolve(__dirname, "perf-results");
const TEXT_LENGTH = 10_000;
const HOVER_FRAMES = 40;
const DRAG_FRAMES = 60;

/** Provisional p95 ceilings (ms) per measurement. */
const CEILINGS: Record<string, number> = {
  "text run hover work (10K chars)": 1_000,
  "text run hover frame (10K chars)": 1_000,
  "text run drag u.top work (10K chars)": 250,
  "text run drag u.top frame (10K chars)": 250,
};

/** Page positions over run glyphs on the canvas, other than the edited one, with their items. */
async function hoverTargets(
  page: Page,
  editor: EditorDriver,
): Promise<{ itemId: TextItemId; position: Point2D }[]> {
  const bounds = await editor.canvasBounds();
  const targets = await textRunHoverTargets(page, bounds);

  return targets.map(({ itemId, position }) => ({
    itemId,
    position: { x: bounds.x + position.x, y: bounds.y + position.y },
  }));
}

test.describe("Performance — 10K-character text run", () => {
  const results: PerfResult[] = [];

  test.afterAll(() => {
    if (results.length === 0) return;

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const table = formatPerfTable(results);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(RESULTS_DIR, `text-run-perf-${timestamp}.md`);
    const report = [
      `# Text Run Perf Report — ${new Date().toISOString()}`,
      "",
      `**Text:** ${TEXT_LENGTH.toLocaleString("en-US")} characters of ǖ-heavy lorem`,
      `**Hover frames:** ${HOVER_FRAMES}`,
      `**Drag frames:** ${DRAG_FRAMES}`,
      "",
      table,
      "",
    ].join("\n");

    fs.writeFileSync(reportPath, report);
    console.log(`\nPerf report written to: ${reportPath}`);
    console.log(table);
  });

  function record(label: string, samples: number[]): void {
    const stats = computeStats(label, samples);
    results.push(stats);
    console.log(`${label}: p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms`);

    const ceiling = CEILINGS[label];
    if (ceiling === undefined) throw new Error(`No ceiling for ${label}`);
    expect(
      stats.p95,
      `${label}: p95 (${stats.p95.toFixed(2)}ms) exceeds ceiling (${ceiling}ms)`,
    ).toBeLessThanOrEqual(ceiling);
  }

  test("hovers run glyphs and drags u's top anchor", async ({ page, editor }) => {
    test.setTimeout(240_000);
    await editor.openGlyphByUnicode("75");

    const text = proofText(TEXT_LENGTH);
    await editor.selectTool("text");
    await expect(page.getByRole("textbox", { name: "Text input" })).toBeFocused();
    await page.keyboard.insertText(text);
    await expect
      .poll(() => editor.canvasText(), { timeout: 60_000 })
      .toMatchObject({ items: { length: 1 + [...text].length } });

    await editor.press("Escape");
    await expect.poll(async () => (await editor.editedNodeIds()).length).toBe(1);
    await editor.setZoom((await editor.zoomLevel()) * 0.5);
    await editor.waitForCanvasRender();

    // Hover: each move lands on another run glyph, so each frame redraws its outline.
    const targets = await hoverTargets(page, editor);
    await installFrameProbe(page);
    expect(targets.length, "run glyphs on the canvas to hover").toBeGreaterThanOrEqual(2);
    const hoverWork: number[] = [];
    const hoverFrame: number[] = [];
    for (let frame = 0; frame < HOVER_FRAMES; frame++) {
      const target = targets[frame % targets.length]!;
      const sample = await measureMove(page, target.position);
      expect(await editor.hoverId()).toBe(target.itemId);
      hoverWork.push(sample.work);
      hoverFrame.push(sample.frame);
    }

    // Drag: press on the anchor, start the drag, then time each move.
    const before = await liveUTopAnchor(page);
    const from = await editor.projectGlyphToPage(before);
    await editor.pointerDown(from);
    await editor.pointerMove({ x: from.x + 6, y: from.y - 3 });
    await expect.poll(() => editor.toolState()).toBe("translating");

    const dragWork: number[] = [];
    const dragFrame: number[] = [];
    for (let frame = 0; frame < DRAG_FRAMES; frame++) {
      const sample = await measureMove(page, {
        x: from.x + 8 + frame * 2,
        y: from.y - 4 - (frame % 7),
      });
      dragWork.push(sample.work);
      dragFrame.push(sample.frame);
    }
    const dragged = await liveUTopAnchor(page);
    expect(dragged.x).toBeGreaterThan(before.x);

    await editor.pointerUp();
    expect(await liveUTopAnchor(page)).toEqual(dragged);
    await editor.undo();
    expect(await liveUTopAnchor(page)).toEqual(before);

    record("text run hover work (10K chars)", hoverWork);
    record("text run hover frame (10K chars)", hoverFrame);
    record("text run drag u.top work (10K chars)", dragWork);
    record("text run drag u.top frame (10K chars)", dragFrame);
  });
});
