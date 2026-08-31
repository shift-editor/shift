import type { Page } from "@playwright/test";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import {
  pointPosition,
  selectVisiblePoint,
  type EditablePointDrag,
} from "./fixtures/editorInteractions";

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

async function dragWithPointerCancel(page: Page, point: EditablePointDrag): Promise<void> {
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
        new PointerEvent("pointercancel", {
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
  shape: "Rectangle Tool (R)",
};

test.describe("Canvas pointer lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, "41");
  });

  test("clears the idle pointer on leave but preserves it during capture", async ({ page }) => {
    const canvas = page.locator("#interactive-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");

    const inside = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + 20,
    };
    const outside = {
      x: inside.x,
      y: bounds.y - 10,
    };
    const hasPointer = () =>
      page.evaluate(() => (window.shift?.editor.input.pointer ?? null) !== null);

    await page.mouse.move(inside.x, inside.y);
    await expect.poll(hasPointer).toBe(true);

    await page.mouse.move(outside.x, outside.y);
    await expect.poll(hasPointer).toBe(false);

    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down();
    await page.mouse.move(outside.x, outside.y);
    await expect.poll(hasPointer).toBe(true);
    await page.mouse.up();
  });

  test("commits a point drag when capture is lost before pointerup", async ({ page }) => {
    const point = await selectVisiblePoint(page);

    await dragWithEarlyCaptureLoss(page, point);
    await page.evaluate(async () => window.shift?.font.editCoordinator.settled());

    const after = await pointPosition(page, point.id);
    expect(after.x).toBeCloseTo(point.expected.x);
    expect(after.y).toBeCloseTo(point.expected.y);
  });

  test("rolls back a point drag canceled by the DOM", async ({ page }) => {
    const point = await selectVisiblePoint(page);
    const before = await pointPosition(page, point.id);

    await dragWithPointerCancel(page, point);
    await page.evaluate(async () => window.shift?.font.editCoordinator.settled());

    expect(await pointPosition(page, point.id)).toEqual(before);
    await expect(page.getByTestId("editor-shell")).toHaveAttribute("data-gesture", "idle");
  });
});

test.describe("Toolbar tools", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, "41");
  });

  for (const [tool, label] of Object.entries(TOOL_LABELS)) {
    test(`${tool} tool active state matches snapshot`, async ({ page }) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForTimeout(300);

      await expect(page).toHaveScreenshot(`tool-${tool}.png`);
    });
  }

  test("selects shape kinds from the menu and keyboard", async ({ page }) => {
    await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
    const rectangleItem = page.getByRole("menuitemcheckbox", { name: "Rectangle R" });
    const circleItem = page.getByRole("menuitemcheckbox", { name: "Circle O" });
    await expect(rectangleItem).toHaveAttribute("aria-checked", "true");
    await expect(circleItem).toHaveAttribute("aria-checked", "false");
    await circleItem.click();
    await expect(page.getByRole("button", { name: "Circle Tool (O)", exact: true })).toBeVisible();

    await page.keyboard.press("r");
    await expect(
      page.getByRole("button", { name: "Rectangle Tool (R)", exact: true }),
    ).toBeVisible();

    await page.keyboard.press("o");
    await expect(page.getByRole("button", { name: "Circle Tool (O)", exact: true })).toBeVisible();
  });

  test("hides unavailable tools", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Text Tool (T)" })).toHaveCount(0);
  });
});
