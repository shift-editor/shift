import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SubmittedGeometry } from "../src/renderer/src/types/rendering";
import {
  test,
  expect,
  navigateToEditor,
  generateContourData,
  computeStats,
  formatPerfTable,
} from "./fixtures/perfApp";
import { measureGeometryPresentation } from "./fixtures/measureGeometryPresentation";

test("pen places visible points within the input-to-geometry frame budget at 50K points", async ({
  page,
}, testInfo) => {
  await navigateToEditor(page, "53");
  const initialCount = await page.evaluate(async (contours) => {
    const editor = window.shift!.editor;
    const inserted = editor.insertContent({ contours });
    if (!inserted) throw new Error("Expected inserted geometry");

    await editor.font.editCoordinator.settled();
    editor.setActiveTool("pen");
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    return editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!.pointCount;
  }, generateContourData(50_000));
  const canvas = await page.locator("#interactive-canvas").boundingBox();
  if (!canvas) throw new Error("Expected interactive canvas");
  const samples: number[] = [];

  for (let index = 0; index < 100; index++) {
    const point = {
      x: canvas.x + 25 + (Math.floor(index / 8) % 2 === 0 ? index % 8 : 7 - (index % 8)) * 20,
      y: canvas.y + 80 + Math.floor(index / 8) * 20,
    };
    await page.mouse.move(point.x, point.y);
    const matchesFrame = await page.evaluateHandle(
      ({ point, count, canvas }) => {
        const editor = window.shift!.editor;
        const node = editor.scene.nodesOfKind("glyph")[0]!;
        const scene = editor.projectScreenToScene({ x: point.x - canvas.x, y: point.y - canvas.y });
        const expected = { x: scene.x - node.position.x, y: scene.y - node.position.y };
        return (geometry: SubmittedGeometry | null) => {
          if (!geometry) return false;

          const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
          if (layer.pointCount !== count) return false;

          const added = layer.contours.at(-1)?.points.at(-1);
          if (!added) return false;

          // The model supplies identity only; coordinates must come from the submitted buffer.
          const submitted = geometry.point(added.id);
          return (
            submitted !== null &&
            Math.abs(submitted.x - expected.x) < 0.1 &&
            Math.abs(submitted.y - expected.y) < 0.1
          );
        };
      },
      { point, count: initialCount + index + 1, canvas },
    );
    try {
      const inputToGeometryFrameMs = await measureGeometryPresentation(
        page,
        testInfo,
        async () => {
          await page.mouse.click(point.x, point.y);
          expect(
            await page.evaluate(() => {
              const editor = window.shift!.editor;
              const node = editor.scene.nodesOfKind("glyph")[0]!;
              return editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!.pointCount;
            }),
          ).toBe(initialCount + index + 1);
        },
        matchesFrame,
      );
      samples.push(inputToGeometryFrameMs);
    } finally {
      await matchesFrame.dispose();
    }
  }

  const stats = computeStats("pen inputToGeometryFrameMs (50K points)", samples);
  const report = [
    "# Pen input-to-visible-geometry performance",
    "",
    "50K points, 100 real pointer clicks. Budgets: p95 ≤ 33 ms; p99 ≤ 50 ms.",
    "",
    "Trusted pointer-release timestamp → Chromium presentation of verified submitted geometry.",
    "Includes probe/tracing overhead, not pixel readback; presentation is a browser/platform estimate.",
    "",
    formatPerfTable([stats]),
  ].join("\n");
  console.log(report);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.resolve(
    __dirname,
    "perf-results",
    `geometry-presentation-${timestamp}.md`,
  );
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report);
  writeFileSync(reportPath.replace(/\.md$/, ".json"), JSON.stringify(stats));
  await testInfo.attach("input-to-geometry-frame-report", {
    path: reportPath,
    contentType: "text/markdown",
  });
  expect.soft(stats.p95, "Pen input-to-visible-geometry p95 exceeds 33 ms").toBeLessThanOrEqual(33);
  expect.soft(stats.p99, "Pen input-to-visible-geometry p99 exceeds 50 ms").toBeLessThanOrEqual(50);
});

test.describe("presentation measurement rejects missing evidence", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, "53");
    await page.keyboard.press("p");
  });

  for (const { title, clicks, error } of [
    {
      title: "does not manufacture an input timestamp for pointer movement",
      clicks: 0,
      error: "Expected exactly one recorded input",
    },
    {
      title: "rejects ambiguous multiple edit inputs",
      clicks: 2,
      error: "Expected exactly one recorded input",
    },
    {
      title: "does not accept a draw that lacks the expected submitted geometry",
      clicks: 1,
      error: "No presented frame contains the expected geometry",
    },
  ]) {
    test(title, async ({ page }, testInfo) => {
      const matchesFrame = await page.evaluateHandle(() => {
        const editor = window.shift!.editor;
        const node = editor.scene.nodesOfKind("glyph")[0]!;
        const point = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!.contours[0]!
          .points[0]!;
        const expectedX = point.x + 10;
        return (geometry: SubmittedGeometry | null) => geometry?.point(point.id)?.x === expectedX;
      });
      try {
        await expect(
          measureGeometryPresentation(
            page,
            testInfo,
            async () => {
              await page.mouse.move(300, 200);
              for (let index = 0; index < clicks; index++) {
                await page
                  .locator("#interactive-canvas")
                  .click({ position: { x: 120 + index * 40, y: 80 } });
              }
            },
            matchesFrame,
          ),
        ).rejects.toThrow(error);
      } finally {
        await matchesFrame.dispose();
      }
    });
  }

  test("rejects a matching submitted baseline despite the preceding clear", async ({
    page,
  }, testInfo) => {
    const matchesFrame = await page.evaluateHandle(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const point = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!.contours[0]!
        .points[0]!;
      const expectedX = point.x;
      return (geometry: SubmittedGeometry | null) => geometry?.point(point.id)?.x === expectedX;
    });
    try {
      await expect(
        measureGeometryPresentation(
          page,
          testInfo,
          async () => {
            await page.locator("#interactive-canvas").click({ position: { x: 120, y: 80 } });
          },
          matchesFrame,
        ),
      ).rejects.toThrow("Expected geometry already matches before input");
    } finally {
      await matchesFrame.dispose();
    }
  });
});
