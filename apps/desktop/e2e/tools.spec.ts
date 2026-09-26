import type { Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { expectCanvasSnapshot, expectPanelSnapshot } from "./fixtures/snapshots";
import type { PointDrag } from "./fixtures/types";

async function dragWithSyntheticPointerEnd(
  page: Page,
  point: PointDrag,
  type: "lostpointercapture" | "pointercancel",
): Promise<void> {
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

  await page.mouse.move(point.startPagePosition.x, point.startPagePosition.y);
  await page.mouse.down();
  await page.mouse.move(point.endPagePosition.x, point.endPagePosition.y, { steps: 5 });
  const pointerId = Number(await canvas.getAttribute("data-e2e-pointer-id"));
  await canvas.evaluate(
    (element, event) => {
      element.dispatchEvent(
        new PointerEvent(event.type, {
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
    {
      type,
      pointerId,
      x: point.endPagePosition.x,
      y: point.endPagePosition.y,
    },
  );
  await page.mouse.up();
}

/** Selects a shape kind and leaves a live draft pressed between two canvas positions. */
async function startShapeDraft(editor: EditorDriver, kind: "Rectangle" | "Ellipse") {
  const page = editor.page;
  if (kind === "Ellipse") {
    await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Ellipse O" }).click();
  } else {
    await page.getByRole("button", { name: "Rectangle Tool (R)", exact: true }).click();
  }

  await editor.pointerDown(await editor.canvasPagePoint({ x: 0.65, y: 0.3 }));
  await editor.pointerMove(await editor.canvasPagePoint({ x: 0.85, y: 0.5 }), 5);
}

/** Reads the selected live shape draft published by the Shape tool. */
async function liveShapeDraft(editor: EditorDriver) {
  return editor.page.evaluate(() => {
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
}

/** Maps tool id to the aria-label on its toolbar button (set via tooltip). */
const TOOL_LABELS: Record<string, string> = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  shape: "Rectangle Tool (R)",
};

test.describe("Canvas pointer lifecycle", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("41");
  });

  test("clears the idle pointer on leave but preserves it during capture", async ({
    page,
    editor,
  }) => {
    const bounds = await editor.canvasBounds();

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

    await editor.pointerDown(inside);
    await editor.pointerMove(outside);
    await expect.poll(hasPointer).toBe(true);
    await editor.pointerUp();
  });

  test("commits a point drag when capture is lost before pointerup", async ({ page, editor }) => {
    const point = await editor.selectVisiblePoint();

    await dragWithSyntheticPointerEnd(page, point, "lostpointercapture");

    const after = await editor.pointPosition(point.id);
    expect(after.x).toBeCloseTo(point.expectedGlyphPosition.x);
    expect(after.y).toBeCloseTo(point.expectedGlyphPosition.y);
  });

  test("rolls back a point drag canceled by the DOM", async ({ page, editor }) => {
    const point = await editor.selectVisiblePoint();
    const before = await editor.pointPosition(point.id);

    await dragWithSyntheticPointerEnd(page, point, "pointercancel");

    expect(await editor.pointPosition(point.id)).toEqual(before);
    await expect(page.getByTestId("editor-shell")).toHaveAttribute("data-gesture", "idle");
  });
});

test.describe("Toolbar tools", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("41");
  });

  for (const [tool, label] of Object.entries(TOOL_LABELS)) {
    test(`${tool} tool active state matches snapshot`, async ({ page }) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.shift?.editor.toolCell.peek()?.id))
        .toBe(tool);
      // Park the pointer so hover styling and the button tooltip are not captured.
      await page.mouse.move(0, 0);

      await expectPanelSnapshot(
        page.getByRole("toolbar", { name: "Editor tools" }),
        `tool-${tool}.png`,
      );
    });
  }

  test("loads crosshair images before the first keyboard shape switch", async ({
    page,
    editor,
  }) => {
    const session = await page.context().newCDPSession(page);
    const { frameTree } = await session.send("Page.getResourceTree");
    await session.detach();
    const loaded = frameTree.resources
      .filter((resource) => resource.type === "Image")
      .map((resource) => new URL(resource.url).pathname.split("/").at(-1));
    expect(loaded).toEqual(
      expect.arrayContaining([
        "crosshair@32.svg",
        "crosshair@64.svg",
        "crosshair@32-circle.svg",
        "crosshair@64-circle.svg",
        "crosshair@32-square.svg",
        "crosshair@64-square.svg",
      ]),
    );

    const canvas = editor.canvas;
    await canvas.hover();
    for (const key of ["o", "r", "o", "r"]) {
      await page.keyboard.press(key);
      await expect(canvas).toHaveCSS(
        "cursor",
        key === "o" ? /crosshair@32-circle\.svg/ : /crosshair@32-square\.svg/,
      );
    }
  });

  test("selects shape kinds from the menu and keyboard", async ({ page, editor }) => {
    await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
    const rectangleItem = page.getByRole("menuitemcheckbox", { name: "Rectangle R" });
    const ellipseItem = page.getByRole("menuitemcheckbox", { name: "Ellipse O" });
    await expect(rectangleItem).toHaveAttribute("aria-checked", "true");
    await expect(ellipseItem).toHaveAttribute("aria-checked", "false");
    await expectPanelSnapshot(page.getByRole("menu"), "shape-menu.png");
    await ellipseItem.click();
    await expect(page.getByRole("button", { name: "Ellipse Tool (O)", exact: true })).toBeVisible();
    const canvas = editor.canvas;
    await canvas.hover();
    await expect(canvas).toHaveCSS("cursor", /crosshair@32-circle\.svg.*12 9, crosshair/);

    await page.keyboard.press("r");
    await expect(
      page.getByRole("button", { name: "Rectangle Tool (R)", exact: true }),
    ).toBeVisible();
    await expect(canvas).toHaveCSS("cursor", /crosshair@32-square\.svg.*12 9, crosshair/);

    await page.keyboard.press("o");
    await expect(page.getByRole("button", { name: "Ellipse Tool (O)", exact: true })).toBeVisible();
    await expect(canvas).toHaveCSS("cursor", /crosshair@32-circle\.svg.*12 9, crosshair/);
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

  for (const kind of ["Rectangle", "Ellipse"] as const) {
    test(`properties follow a live ${kind} draft and keep its identity on release`, async ({
      page,
      editor,
    }) => {
      await startShapeDraft(editor, kind);
      const draft = await liveShapeDraft(editor);
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
      await expect(properties.getByLabel("Width", { exact: true })).toBeEnabled();

      await editor.pointerUp();
      await expect
        .poll(() => page.evaluate(() => window.shift!.editor.toolCell.peek()?.id))
        .toBe("select");
      await expect.poll(() => editor.selectionIds()).toEqual([draft.id]);
      await expect(properties.getByLabel("Width", { exact: true })).toBeEnabled();
      await expect(properties.getByLabel("Width", { exact: true })).toHaveValue(
        String(Math.round(draft.bounds.width)),
      );
    });

    test(`renders a live ${kind} draft and its committed selection`, async ({ editor }) => {
      await startShapeDraft(editor, kind);
      await expectCanvasSnapshot(editor, `${kind}-draft.png`);

      await editor.pointerUp();
      await expect.poll(() => editor.selectionIds()).toHaveLength(1);
      await expectCanvasSnapshot(editor, `${kind}-committed.png`);
    });
  }

  test("updates an ellipse draft with Shift and restores the previous selection on Escape", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const selection = await editor.selectionIds();
    await page.getByRole("button", { name: "Rectangle Tool (R) options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Ellipse O" }).click();
    const bounds = await editor.canvasBounds();
    await editor.pointerDown({
      x: bounds.x + bounds.width * 0.65,
      y: bounds.y + bounds.height * 0.25,
    });
    await editor.pointerMove(
      { x: bounds.x + bounds.width * 0.85, y: bounds.y + bounds.height * 0.4 },
      5,
    );
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
    await editor.cancelGesture();
    await expect.poll(() => editor.selectionIds()).toEqual(selection);
    expect(await page.evaluate((id) => window.shift!.editor.object(id), draft.ids[0])).toBeNull();
  });

  test("hides unavailable tools", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Text Tool (T)" })).toHaveCount(0);
  });
});
