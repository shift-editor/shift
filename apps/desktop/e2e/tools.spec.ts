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
    const ellipseItem = page.getByRole("menuitemcheckbox", { name: "Ellipse O" });
    await expect(rectangleItem).toHaveAttribute("aria-checked", "true");
    await expect(ellipseItem).toHaveAttribute("aria-checked", "false");
    await expect(page).toHaveScreenshot("shape-menu.png");
    await ellipseItem.click();
    await expect(page.getByRole("button", { name: "Ellipse Tool (O)", exact: true })).toBeVisible();

    await page.keyboard.press("r");
    await expect(
      page.getByRole("button", { name: "Rectangle Tool (R)", exact: true }),
    ).toBeVisible();

    await page.keyboard.press("o");
    await expect(page.getByRole("button", { name: "Ellipse Tool (O)", exact: true })).toBeVisible();
  });

  for (const label of ["Ellipse Tool (O)", "Select Tool (V)", "Pen Tool (P)", "Hand Tool (H)"]) {
    test(`preserves the selected shape after clicking ${label}`, async ({ page }) => {
      await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Ellipse O" }).click();

      await page.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "Ellipse Tool (O)", exact: true }).click();

      await expect
        .poll(() => page.evaluate(() => window.shift?.editor.toolCell.peek()?.id))
        .toBe("shape");
      await expect(
        page.getByRole("button", { name: "Ellipse Tool (O)", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Ellipse Tool (O) options" }).click();
      await expect(page.getByRole("menuitemcheckbox", { name: "Ellipse O" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  }

  for (const kind of ["Rectangle", "Ellipse"]) {
    test(`inspects a live ${kind} draft and keeps its identity on release`, async ({
      page,
    }, testInfo) => {
      if (kind === "Ellipse") {
        await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
        await page.getByRole("menuitemcheckbox", { name: "Ellipse O" }).click();
      } else {
        await page.getByRole("button", { name: "Rectangle Tool (R)", exact: true }).click();
      }
      const canvas = page.locator("#interactive-canvas");
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error("Expected interactive canvas bounds");
      await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.5, {
        steps: 5,
      });

      const draft = await page.evaluate(() => {
        const editor = window.shift!.editor;
        const id = editor.selection.ids[0];
        const object = editor.object(id);
        if (object?.kind !== "contour") throw new Error("Expected a selected draft contour");
        const contour = object.geometry.contour(object.contourId)!;
        return {
          id,
          bounds: editor.selectionBounds()!,
          points: contour.points.length,
          handles: editor.handlesVisible(contour.id),
        };
      });
      expect(draft.points).toBe(kind === "Ellipse" ? 12 : 4);
      expect(draft.handles).toBe(false);
      const properties = page.getByRole("complementary", { name: "Glyph properties" });
      await expect(properties.getByLabel("X position", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.x)),
      );
      await expect(properties.getByLabel("Y position", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.y)),
      );
      await expect(properties.getByLabel("Width", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.width)),
      );
      await expect(properties.getByLabel("Height", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.height)),
      );
      await expect(properties.getByLabel("Width", { exact: true })).toBeDisabled();
      await expect(page).toHaveScreenshot(`${kind}-draft.png`);
      await testInfo.attach(`${kind}-draft`, {
        body: await page.screenshot({ path: testInfo.outputPath(`${kind}-draft.png`) }),
        contentType: "image/png",
      });

      await page.mouse.up();
      await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
      await expect
        .poll(() => page.evaluate(() => window.shift!.editor.toolCell.peek()?.id))
        .toBe("select");
      await expect
        .poll(() => page.evaluate(() => window.shift!.editor.selection.ids))
        .toEqual([draft.id]);
      await expect(properties.getByLabel("Width", { exact: true })).toBeEnabled();
      await expect(properties.getByLabel("Width", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.width)),
      );
      await expect(page).toHaveScreenshot(`${kind}-committed.png`);
      await testInfo.attach(`${kind}-committed`, {
        body: await page.screenshot({ path: testInfo.outputPath(`${kind}-committed.png`) }),
        contentType: "image/png",
      });
    });
  }

  test("updates an ellipse draft with Shift and restores the previous selection on Escape", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+a");
    const selection = await page.evaluate(() => window.shift!.editor.selection.ids);
    await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Ellipse O" }).click();
    const canvas = page.locator("#interactive-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.4, {
      steps: 5,
    });
    const draft = await page.evaluate(() => ({
      ids: window.shift!.editor.selection.ids,
      bounds: window.shift!.editor.selectionBounds()!,
    }));
    const properties = page.getByRole("complementary", { name: "Glyph properties" });
    const width = properties.getByLabel("Width", { exact: true });
    const height = properties.getByLabel("Height", { exact: true });
    await page.keyboard.down("Shift");
    await expect
      .poll(async () => [await width.inputValue(), await height.inputValue()])
      .toEqual([
        String(Math.round(Math.max(draft.bounds.width, draft.bounds.height))),
        String(Math.round(Math.max(draft.bounds.width, draft.bounds.height))),
      ]);
    await page.keyboard.up("Shift");
    await expect(height).toHaveValue(String(Math.round(draft.bounds.height)));
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.shift!.editor.selection.ids))
      .toEqual(selection);
    expect(await page.evaluate((id) => window.shift!.editor.object(id), draft.ids[0])).toBeNull();
  });

  test("hides an individual handle on canvas and restores the same rendered image", async ({
    page,
  }, testInfo) => {
    const canvas = page.locator("#interactive-canvas");
    const before = await canvas.screenshot({
      path: testInfo.outputPath("individual-handle-before.png"),
    });
    const showHandles = await page.evaluateHandle(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0];
      const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
      return editor.hideHandles(layer.contours[0].points[0].id);
    });
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
    await testInfo.attach("individual-handle-hidden", {
      body: await page.screenshot({ path: testInfo.outputPath("individual-handle-hidden.png") }),
      contentType: "image/png",
    });
    await showHandles.evaluate((show) => show());
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(true);
    await showHandles.dispose();
  });

  test("hides unavailable tools", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Text Tool (T)" })).toHaveCount(0);
  });
});
