import type { Page } from "@playwright/test";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";

interface EditablePointDrag {
  readonly id: string;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly expected: { readonly x: number; readonly y: number };
}

async function selectVisiblePoint(page: Page): Promise<EditablePointDrag> {
  const point = await page.evaluate(() => {
    const workspace = window.shift;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const layer = node ? glyph?.layerForSource(node.sourceId) : null;
    if (!workspace || !canvas || !node || !layer) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    const candidates = layer.allPoints
      .filter((candidate) => candidate.pointType === "onCurve")
      .map((candidate) => ({
        point: candidate,
        screen: workspace.editor.projectSceneToScreen({
          x: candidate.x + node.position.x,
          y: candidate.y + node.position.y,
        }),
      }))
      .filter(
        ({ screen }) =>
          screen.x >= 50 &&
          screen.y >= 50 &&
          screen.x <= bounds.width - 100 &&
          screen.y <= bounds.height - 100,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.screen.x - bounds.width / 2, a.screen.y - bounds.height / 2) -
          Math.hypot(b.screen.x - bounds.width / 2, b.screen.y - bounds.height / 2),
      );
    const candidate = candidates[0];
    if (!candidate) throw new Error("Expected visible on-curve point");

    const endScreen = { x: candidate.screen.x + 40, y: candidate.screen.y + 30 };
    const endScene = workspace.editor.projectScreenToScene(endScreen);
    return {
      id: candidate.point.id,
      start: { x: bounds.left + candidate.screen.x, y: bounds.top + candidate.screen.y },
      end: { x: bounds.left + endScreen.x, y: bounds.top + endScreen.y },
      expected: { x: endScene.x - node.position.x, y: endScene.y - node.position.y },
    };
  });

  await page.mouse.click(point.start.x, point.start.y);
  await expect
    .poll(() =>
      page.evaluate(
        (pointId) => window.shift?.editor.selection.ids.some((id) => id === pointId) ?? false,
        point.id,
      ),
    )
    .toBe(true);

  return point;
}

async function pointPosition(page: Page, pointId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const workspace = window.shift;
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const point = node
      ? glyph?.layerForSource(node.sourceId)?.allPoints.find((candidate) => candidate.id === id)
      : null;
    if (!point) throw new Error("Expected editable point");

    return { x: point.x, y: point.y };
  }, pointId);
}

async function dragWithEarlyCaptureLoss(page: Page, point: EditablePointDrag): Promise<void> {
  const canvas = page.locator("#interactive-canvas");
  await canvas.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) => {
        element.dataset.e2ePointerId = String((event as PointerEvent).pointerId);
      },
      { once: true },
    );
  });

  await page.mouse.move(point.start.x, point.start.y);
  await page.mouse.down();
  await page.mouse.move(point.end.x, point.end.y, { steps: 5 });
  const pointerId = Number(await canvas.getAttribute("data-e2e-pointer-id"));
  await canvas.evaluate(
    (element, event) => {
      element.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          bubbles: true,
          pointerId: event.pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: -1,
          buttons: 0,
          clientX: event.x,
          clientY: event.y,
        }),
      );
    },
    { pointerId, x: point.end.x, y: point.end.y },
  );
  await page.mouse.up();
}

/** Maps tool id to the aria-label on its toolbar button (set via tooltip). */
const TOOL_LABELS: Record<string, string> = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  shape: "Shape Tool (S)",
  text: "Text Tool (T)",
};

test.describe("Canvas pointer lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, "41");
  });

  test("commits a point drag when capture is lost before pointerup", async ({ page }) => {
    const point = await selectVisiblePoint(page);

    await dragWithEarlyCaptureLoss(page, point);
    await page.evaluate(async () => window.shift?.font.editCoordinator.settled());

    const after = await pointPosition(page, point.id);
    expect(after.x).toBeCloseTo(point.expected.x);
    expect(after.y).toBeCloseTo(point.expected.y);
  });
});

test.describe("Toolbar tools", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, "41");
  });

  for (const [tool, label] of Object.entries(TOOL_LABELS)) {
    test(`${tool} tool active state matches snapshot`, async ({ page }) => {
      await page.getByRole("button", { name: label }).click();
      await page.waitForTimeout(300);

      await expect(page).toHaveScreenshot(`tool-${tool}.png`);
    });
  }
});
