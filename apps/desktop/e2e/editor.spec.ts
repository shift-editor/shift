import type { Locator } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { editorSidebar, glyphProperties } from "./fixtures/appLocators";
import {
  expectCanvasSnapshot,
  expectPanelSnapshot,
  expectPageSnapshot,
} from "./fixtures/snapshots";

/** Opens A and returns three distinct fixture points for alignment scenarios. */
async function alignmentFixture(editor: EditorDriver) {
  await editor.openGlyphByUnicode("41");
  const outline = await editor.outline();
  const available = outline.flatMap((contour) => contour.points);
  const first = available[0];
  const second = available.find((point) => point.x !== first?.x && point.y !== first?.y);
  const third = available.find((point) => point.id !== first?.id && point.id !== second?.id);
  if (!first || !second || !third) throw new Error("Expected three distinct fixture points");

  return editor.pointTargets([first.id, second.id, third.id]);
}

test("enables alignment for two selected points while distribution still requires three", async ({
  page,
  editor,
}) => {
  const points = await alignmentFixture(editor);
  const properties = glyphProperties(page);
  const canvas = editor.canvas;
  const alignLeft = properties.getByRole("button", { name: "Align left", exact: true });
  const distribute = properties.getByRole("button", {
    name: "Distribute horizontally",
    exact: true,
  });

  await expect(alignLeft).toHaveCount(0);
  await canvas.click({ position: points[0].canvasPosition });
  await expect(alignLeft).toBeDisabled();
  await expect(distribute).toBeDisabled();
  await properties
    .getByRole("button", { name: "Flip vertically", exact: true })
    .scrollIntoViewIfNeeded();
  await expectPanelSnapshot(properties, "one-point-alignment-disabled.png");

  await canvas.click({ position: points[1].canvasPosition, modifiers: ["Shift"] });
  await expect
    .poll(() => editor.selectionIds())
    .toEqual(points.slice(0, 2).map((point) => point.id));
  for (const name of [
    "Align left",
    "Align horizontal centers",
    "Align right",
    "Align top",
    "Align vertical centers",
    "Align bottom",
  ]) {
    await expect(properties.getByRole("button", { name, exact: true })).toBeEnabled();
    await expect(properties.getByRole("button", { name, exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  for (const name of ["Rotate 90 degrees clockwise", "Flip horizontally", "Flip vertically"]) {
    await expect(properties.getByRole("button", { name, exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
  await expect(distribute).toBeDisabled();
  await expect(
    properties.getByRole("button", { name: "Distribute vertically", exact: true }),
  ).toBeDisabled();
  await expectPanelSnapshot(properties, "two-point-transform-controls.png");

  await canvas.click({ position: points[2].canvasPosition, modifiers: ["Shift"] });
  await expect(distribute).toBeEnabled();
  await expect(
    properties.getByRole("button", { name: "Distribute vertically", exact: true }),
  ).toBeEnabled();
});

test("aligns two selected points left as one undoable edit", async ({ page, editor }) => {
  const points = await alignmentFixture(editor);
  const selected = points.slice(0, 2);
  const selectedPositions = async () =>
    (await editor.pointTargets(selected.map((point) => point.id))).map(
      (point) => point.glyphPosition,
    );

  await editor.canvas.click({ position: selected[0].canvasPosition });
  await editor.canvas.click({ position: selected[1].canvasPosition, modifiers: ["Shift"] });
  await expect.poll(() => editor.selectionIds()).toEqual(selected.map((point) => point.id));

  await glyphProperties(page).getByRole("button", { name: "Align left", exact: true }).click();
  await expect.poll(selectedPositions).toEqual(
    selected.map((point) => ({
      x: Math.min(selected[0].glyphPosition.x, selected[1].glyphPosition.x),
      y: point.glyphPosition.y,
    })),
  );
  await editor.undo();
  await expect.poll(selectedPositions).toEqual(selected.map((point) => point.glyphPosition));
});

test("switches Alt during proportional resizing and preserves release geometry", async ({
  page,
  editor,
}) => {
  await editor.openGlyphByUnicode("41");
  await editor.selectAll();
  const canvas = editor.canvas;
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error("Expected interactive canvas bounds");
  const { initialBounds, down, normal, centered, crossed } = await page.evaluate(() => {
    const editor = window.shift!.editor;
    const initialBounds = editor.selectionBounds();
    if (!initialBounds) throw new Error("Expected selection bounds");
    return {
      initialBounds,
      down: editor.projectSceneToScreen({ x: initialBounds.right, y: initialBounds.bottom }),
      normal: editor.projectSceneToScreen({
        x: initialBounds.right + initialBounds.width * 0.1,
        y: initialBounds.bottom + initialBounds.height * 0.02,
      }),
      centered: editor.projectSceneToScreen({
        x: initialBounds.right + initialBounds.width * 0.15,
        y: initialBounds.bottom + initialBounds.height * 0.03,
      }),
      crossed: editor.projectSceneToScreen({
        x: initialBounds.x + initialBounds.width * 0.25,
        y: initialBounds.bottom + initialBounds.height * 0.03,
      }),
    };
  });

  await page.mouse.move(canvasBounds.x + down.x, canvasBounds.y + down.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  try {
    await page.mouse.move(canvasBounds.x + normal.x, canvasBounds.y + normal.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect.poll(() => editor.toolState()).toBe("resizing");

    await page.keyboard.down("Alt");
    await page.mouse.move(canvasBounds.x + centered.x, canvasBounds.y + centered.y, { steps: 3 });
    await editor.flushPointerMoves();
    const preview = await editor.selectionBounds();
    expect(preview.width / initialBounds.width).toBeCloseTo(1.3);
    expect(preview.height / initialBounds.height).toBeCloseTo(1.3);
    expect(preview.x + preview.width / 2).toBeCloseTo(initialBounds.x + initialBounds.width / 2);
    expect(preview.y + preview.height / 2).toBeCloseTo(initialBounds.y + initialBounds.height / 2);
    await expect(canvas).toHaveCSS("cursor", /nesw-resize$/);

    await page.mouse.move(canvasBounds.x + crossed.x, canvasBounds.y + crossed.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect(canvas).toHaveCSS("cursor", /nwse-resize$/);
    await page.mouse.move(canvasBounds.x + centered.x, canvasBounds.y + centered.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect(canvas).toHaveCSS("cursor", /nesw-resize$/);
    expect(await editor.selectionBounds()).toEqual(preview);

    await page.keyboard.up("Alt");
    await page.mouse.move(canvasBounds.x + normal.x, canvasBounds.y + normal.y, { steps: 3 });
    await editor.flushPointerMoves();
    const uncentered = await editor.selectionBounds();
    expect(uncentered.x).toBeCloseTo(initialBounds.x);
    expect(uncentered.y).toBeCloseTo(initialBounds.y);
    expect(uncentered.width / initialBounds.width).toBeCloseTo(1.1);
    expect(uncentered.height / initialBounds.height).toBeCloseTo(1.1);

    await page.keyboard.down("Alt");
    await page.mouse.move(canvasBounds.x + centered.x, canvasBounds.y + centered.y, { steps: 3 });
    await editor.flushPointerMoves();
    expect(await editor.selectionBounds()).toEqual(preview);
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
    await page.mouse.up();
    await editor.waitForIdle();
    expect(await editor.selectionBounds()).toEqual(preview);
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
  }
});

async function selectionCenter(editor: EditorDriver) {
  const bounds = await editor.selectionBounds();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function elementWidth(element: Locator): Promise<number> {
  return (await element.boundingBox())?.width ?? 0;
}

test.describe("Editor view", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("41");
  });

  test("selects displayed glyph objects from the Objects tab", async ({ page, editor }) => {
    const sidebar = editorSidebar(page);
    const contour = (await editor.outline())[0];
    const firstPoint = contour?.points[0];
    const secondPoint = contour?.points[1];
    const thirdPoint = contour?.points[2];
    const fourthPoint = contour?.points[3];
    if (!contour || !firstPoint || !secondPoint || !thirdPoint || !fourthPoint) {
      throw new Error("Expected contour fixture points");
    }

    await expect(sidebar.getByRole("tab", { name: "Objects" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectPanelSnapshot(sidebar, "objects-sidebar.png");
    await sidebar.getByTestId(`object-${firstPoint.id}`).click();
    await expect.poll(() => editor.selectionIds()).toEqual([firstPoint.id]);

    await sidebar.getByTestId(`object-${thirdPoint.id}`).click({ modifiers: ["Meta"] });
    await expect.poll(() => editor.selectionIds()).toEqual([firstPoint.id, thirdPoint.id]);

    await sidebar.getByTestId(`object-${firstPoint.id}`).click();
    await sidebar.getByTestId(`object-${fourthPoint.id}`).click({ modifiers: ["Shift"] });
    await expect
      .poll(() => editor.selectionIds())
      .toEqual([firstPoint.id, secondPoint.id, thirdPoint.id, fourthPoint.id]);
    await expectPanelSnapshot(sidebar, "objects-sidebar-selection.png");

    await sidebar.getByTestId(`object-${contour.id}`).click();
    await expect.poll(() => editor.selectionIds()).toEqual([contour.id]);
    await expect(sidebar.getByTestId(`object-${contour.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("edits anchor X and Y positions without restoring stale coordinates", async ({
    page,
    editor,
  }) => {
    await editor.openGlyphByName("E");
    const anchorId = await page.evaluate(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0];
      if (!node) throw new Error("Expected glyph node");
      const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
      if (!layer) throw new Error("Expected editable glyph layer");

      return layer.addAnchor("top", { x: 200, y: 700 });
    });
    await editor.waitForIdle();
    const anchorRow = editorSidebar(page).getByTestId(`object-${anchorId}`);
    await expect(anchorRow).toBeVisible();
    await anchorRow.click();

    const anchorPosition = () =>
      page.evaluate(() => {
        const editor = window.shift!.editor;
        const id = editor.selection.ids[0];
        const object = id ? editor.object(id) : null;
        if (object?.kind !== "anchor") throw new Error("Expected selected anchor");
        const anchor = object.geometry.anchor(object.anchorId);
        if (!anchor) throw new Error("Expected anchor geometry");

        return { x: anchor.x, y: anchor.y };
      });
    const initialPosition = await anchorPosition();
    const properties = glyphProperties(page);
    const targetX = Math.round(initialPosition.x) + 25;
    const targetY = Math.round(initialPosition.y) + 30;

    await editor.commitInputValue(
      properties.getByLabel("Anchor X position", { exact: true }),
      targetX,
    );
    await editor.commitInputValue(
      properties.getByLabel("Anchor Y position", { exact: true }),
      targetY,
    );

    await expect.poll(anchorPosition).toEqual({ x: targetX, y: targetY });
    await editor.undo();
    await editor.undo();
    await expect.poll(anchorPosition).toEqual(initialPosition);
  });

  test("full editor matches snapshot", async ({ page, editor }) => {
    await editor.waitForCanvasRender();
    await page.mouse.move(0, 0);
    await expectPageSnapshot(page, "editor-glyph-A.png");
  });

  test("resets sidebars to their default width on divider double-click", async ({ page }) => {
    const layout = page.getByTestId("editor-layout-panels");
    const leftSidebar = layout.getByTestId("left-sidebar-panel");
    const rightSidebar = layout.getByTestId("right-sidebar-panel");
    const leftDivider = layout.getByRole("separator", { name: "Resize left sidebar" });
    const rightDivider = layout.getByRole("separator", { name: "Resize right sidebar" });
    const layoutWidth = await elementWidth(layout);
    const defaultWidth = layoutWidth * 0.15;

    await leftDivider.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => elementWidth(leftSidebar)).toBeGreaterThan(defaultWidth);
    await leftDivider.dispatchEvent("dblclick");
    await expect.poll(() => elementWidth(leftSidebar)).toBeCloseTo(defaultWidth, 0);

    await rightDivider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => elementWidth(rightSidebar)).toBeGreaterThan(defaultWidth);
    await rightDivider.dispatchEvent("dblclick");
    await expect.poll(() => elementWidth(rightSidebar)).toBeCloseTo(defaultWidth, 0);
    await expect.poll(() => elementWidth(leftSidebar)).toBeCloseTo(defaultWidth, 0);
  });

  test("toolbar toggles both sidebars without reflowing their contents", async ({ page }) => {
    const layout = page.getByTestId("editor-layout-panels");
    const leftPanel = layout.getByTestId("left-sidebar-panel");
    const rightPanel = layout.getByTestId("right-sidebar-panel");
    const leftContent = editorSidebar(page);
    const rightContent = page.getByRole("complementary", { name: "Glyph properties" });
    const leftWidth = await elementWidth(leftContent);
    const rightWidth = await elementWidth(rightContent);

    await page.getByRole("button", { name: "Toggle left sidebar" }).click();
    await expect.poll(() => elementWidth(leftPanel)).toBe(0);
    await expect
      .poll(async () => Math.abs((await elementWidth(leftContent)) - leftWidth))
      .toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Toggle right sidebar" }).click();
    await expect.poll(() => elementWidth(rightPanel)).toBe(0);
    await expect
      .poll(async () => Math.abs((await elementWidth(rightContent)) - rightWidth))
      .toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Toggle right sidebar" }).click();
    await expect.poll(() => elementWidth(rightPanel)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Toggle left sidebar" }).click();
    await expect.poll(() => elementWidth(leftPanel)).toBeGreaterThan(0);
  });

  test("keeps custom cursors on the canvas while hovering and bending across sidebars", async ({
    page,
    editor,
  }) => {
    const canvas = editor.canvas;
    const down = await page.evaluate(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0];
      if (!node) throw new Error("Expected glyph node");
      const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
      const segment = layer?.contours[0]?.segments()[0];
      if (!segment) throw new Error("Expected segment");
      const point = segment.pointAt(0.5);

      return editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
    });

    await canvas.hover({ position: down });
    await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
    await page.keyboard.down("Alt");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
    } finally {
      await page.keyboard.up("Alt");
    }
    await canvas.click({ position: down, modifiers: ["Meta"] });
    await editor.waitForIdle();
    await page.keyboard.down("Meta");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
      for (const sidebar of [editorSidebar(page), glyphProperties(page)]) {
        await sidebar.hover({ position: { x: 10, y: 10 } });
        await expect(sidebar).not.toHaveCSS("cursor", /cursors\//);
      }

      await canvas.hover({ position: down });
      await page.mouse.down();
      for (const sidebar of [editorSidebar(page), glyphProperties(page)]) {
        await expect(sidebar).not.toHaveCSS("cursor", /cursors\//);
        const bounds = await sidebar.boundingBox();
        if (!bounds) throw new Error("Expected sidebar bounds");
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
          steps: 3,
        });
        await expect.poll(() => editor.toolState()).toBe("bending");
        await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
        await expect(sidebar).not.toHaveCSS("cursor", /cursors\//);
      }
    } finally {
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Meta");
    }
    await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
  });

  test("previews upgrade handles on Cmd-hover and commits those positions on Cmd-click", async ({
    page,
    editor,
  }) => {
    const canvas = editor.canvas;
    const preview = await page.evaluate(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0];
      const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
      const segment = layer.contours[0].segments().find((segment) => segment.type === "line");
      if (!segment) throw new Error("Expected line segment");
      const middle = segment.pointAt(1 / 2);
      return {
        id: segment.id,
        controls: [1 / 3, 2 / 3].map((t) => segment.pointAt(t)),
        sceneControls: [1 / 3, 2 / 3].map((t) => {
          const point = segment.pointAt(t);
          return { x: point.x + node.position.x, y: point.y + node.position.y };
        }),
        hover: editor.projectSceneToScreen({
          x: middle.x + node.position.x,
          y: middle.y + node.position.y,
        }),
      };
    });
    // The Select tool's upgrade preview item publishes the scene positions it draws;
    // null means no preview is rendered.
    const previewHandles = () =>
      page.evaluate(() => {
        const tool = window.shift?.editor.toolManager.activeTool;
        if (tool?.id !== "select" || !("upgradePreview" in tool)) return null;

        const preview = tool.upgradePreview as { propsSnapshot(): unknown };
        return preview.propsSnapshot() ?? null;
      });

    await canvas.hover({ position: preview.hover });
    await expect.poll(previewHandles).toBeNull();
    await page.keyboard.down("Meta");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
      await expect.poll(previewHandles).toEqual(preview.sceneControls);
      await expectCanvasSnapshot(editor, "segment-upgrade-preview.png");

      await page.keyboard.up("Meta");
      await expect.poll(previewHandles).toBeNull();
      await page.keyboard.down("Meta");
      await expect.poll(previewHandles).toEqual(preview.sceneControls);
      await glyphProperties(page).hover({ position: { x: 10, y: 10 } });
      await expect.poll(previewHandles).toBeNull();
      await canvas.hover({ position: preview.hover });
      await expect.poll(previewHandles).toEqual(preview.sceneControls);

      await canvas.click({ position: preview.hover });
      await editor.waitForIdle();
      const controls = await page.evaluate((id) => {
        const object = window.shift!.editor.object(id);
        if (object?.kind !== "segment") throw new Error("Expected upgraded segment");
        const cubic = object.layer?.segment(id)?.asCubic();
        if (!cubic) throw new Error("Expected cubic segment");
        return [cubic.controlStart, cubic.controlEnd].map(({ x, y }) => ({ x, y }));
      }, preview.id);
      controls.forEach((point, index) => {
        expect(point.x).toBeCloseTo(preview.controls[index].x, 6);
        expect(point.y).toBeCloseTo(preview.controls[index].y, 6);
      });
      await expect.poll(previewHandles).toBeNull();
      await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
    } finally {
      await page.keyboard.up("Meta");
    }
  });

  test("shows the add cursor for Shift-hover and adds the point to the selection", async ({
    page,
    editor,
  }) => {
    const canvas = editor.canvas;
    const outline = await editor.outline();
    const pointIds = outline[0]?.points.slice(0, 2).map((point) => point.id) ?? [];
    const points = await editor.pointTargets(pointIds);
    if (points.length !== 2) throw new Error("Expected two editable points");

    await canvas.click({ position: points[0].canvasPosition });
    await canvas.hover({ position: points[1].canvasPosition });
    await expect(canvas).not.toHaveCSS("cursor", /cursor@32-add\.svg/);
    await page.keyboard.down("Alt");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
    } finally {
      await page.keyboard.up("Alt");
    }
    await page.keyboard.down("Shift");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32-add\.svg/);
      await page.keyboard.up("Shift");
      await expect(canvas).not.toHaveCSS("cursor", /cursor@32-add\.svg/);
      await page.keyboard.down("Shift");
      await canvas.click({ position: points[1].canvasPosition });
      await expect.poll(() => editor.selectionIds()).toEqual(points.map((point) => point.id));
      await expect(canvas).not.toHaveCSS("cursor", /cursor@32-add\.svg/);
    } finally {
      await page.keyboard.up("Shift");
    }
  });

  test("remains interactive after a renderer reload", async ({ page, editor }) => {
    await page.reload();
    await expect(page.locator("#scene-canvas")).toBeVisible({ timeout: 15_000 });

    await editor.selectAll();
    await expect.poll(async () => (await editor.selectionIds()).length).toBeGreaterThan(0);
  });

  test("composited canvas matches snapshot", async ({ editor }) => {
    await expectCanvasSnapshot(editor, "editor-canvas-A.png");
  });

  test("shows Boolean operations for two completely selected contours", async ({ page }) => {
    await page.keyboard.press("Meta+a");

    await expect(glyphProperties(page).getByText("Boolean", { exact: true })).toBeVisible();
  });

  test("explains icon-only editor actions on hover", async ({ page }) => {
    const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
    const selectTool = toolbar.getByRole("button", { name: "Select Tool (V)" });
    await selectTool.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Select Tool (V)");

    await page.keyboard.press("Meta+a");
    const rotate = glyphProperties(page).getByRole("button", {
      name: "Rotate 90 degrees clockwise",
    });
    await rotate.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Rotate 90 degrees clockwise");

    const scaleAnchor = glyphProperties(page).getByRole("button", {
      name: "Anchor top left",
    });
    await scaleAnchor.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Anchor top left");
  });

  test("keeps advance width text current after a sidebar metrics edit", async ({
    page,
    editor,
  }) => {
    const properties = glyphProperties(page);
    const advanceInput = properties.getByLabel("Advance width", { exact: true });
    const rightSidebearingInput = properties.getByLabel("Right sidebearing", { exact: true });
    const initialAdvance = Number(await advanceInput.inputValue());
    const initialRightSidebearing = Number(await rightSidebearingInput.inputValue());

    await editor.commitInputValue(rightSidebearingInput, initialRightSidebearing + 25);

    await expect(advanceInput).toHaveValue(String(initialAdvance + 25));
  });

  test("does not move a selection when its displayed position is reapplied", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const properties = glyphProperties(page);
    const xInput = properties.getByLabel("X position", { exact: true });
    const yInput = properties.getByLabel("Y position", { exact: true });
    const initialBounds = await editor.selectionBounds();

    await expect(xInput).toHaveValue(String(Math.round(initialBounds.x)));
    await expect(yInput).toHaveValue(String(Math.round(initialBounds.y)));
    await xInput.press("Enter");
    await yInput.press("Enter");

    await expect.poll(() => editor.selectionBounds()).toEqual(initialBounds);
  });

  test("positions a selection from its top-left independently of the scale anchor", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const properties = glyphProperties(page);
    const xInput = properties.getByLabel("X position", { exact: true });
    const yInput = properties.getByLabel("Y position", { exact: true });
    const initialBounds = await editor.selectionBounds();
    const targetX = Math.round(initialBounds.x) + 25;
    const targetY = Math.round(initialBounds.y) + 30;

    await properties.getByLabel("Anchor top left", { exact: true }).click();
    await editor.commitInputValue(xInput, targetX);
    await editor.commitInputValue(yInput, targetY);

    await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: targetX, y: targetY });
  });

  for (const releaseShiftFirst of [true, false]) {
    test(`keeps constrained drag geometry when Shift is released ${releaseShiftFirst ? "before" : "after"} mouseup`, async ({
      page,
      editor,
    }) => {
      await editor.selectAll();
      const initialBounds = await editor.selectionBounds();
      const canvasBounds = await editor.canvas.boundingBox();
      if (!canvasBounds) throw new Error("Expected interactive canvas bounds");
      const { down, end } = await page.evaluate(() => {
        const editor = window.shift!.editor;
        const bounds = editor.selectionBounds();
        if (!bounds) throw new Error("Expected selection bounds");

        return {
          down: editor.projectSceneToScreen({ x: bounds.right, y: bounds.bottom }),
          end: editor.projectSceneToScreen({
            x: bounds.right + bounds.width * 0.15,
            y: bounds.bottom + bounds.height * 0.03,
          }),
        };
      });

      await page.mouse.move(canvasBounds.x + down.x, canvasBounds.y + down.y);
      await page.keyboard.down("Shift");
      await page.mouse.down();
      try {
        await page.mouse.move(canvasBounds.x + end.x, canvasBounds.y + end.y, { steps: 3 });
        await editor.flushPointerMoves();
        await expect.poll(() => editor.toolState()).toBe("resizing");
        const preview = await editor.selectionBounds();
        expect(preview.width).toBeGreaterThan(initialBounds.width);
        expect(preview.width / initialBounds.width).toBeCloseTo(
          preview.height / initialBounds.height,
        );

        if (releaseShiftFirst) await page.keyboard.up("Shift");
        await page.mouse.up();
        if (!releaseShiftFirst) await page.keyboard.up("Shift");
        await editor.waitForIdle();

        expect(await editor.selectionBounds()).toEqual(preview);
      } finally {
        await page.mouse.up();
        await page.keyboard.up("Shift");
      }
    });
  }

  for (const dimension of ["width", "height"] as const) {
    for (const anchor of ["Anchor top left", "Anchor bottom right"]) {
      test(`changes dimension ${dimension} independently from visual top-left with ${anchor}`, async ({
        page,
        editor,
      }) => {
        await editor.selectAll();
        const properties = glyphProperties(page);
        const initialBounds = await editor.selectionBounds();
        await properties.getByLabel(anchor, { exact: true }).click();
        await editor.commitInputValue(
          properties.getByLabel(`Dimension ${dimension}`, { exact: true }),
          initialBounds[dimension] * 2,
        );

        await expect
          .poll(() => editor.selectionBounds())
          .toMatchObject({
            x: initialBounds.x,
            y: dimension === "height" ? initialBounds.y - initialBounds.height : initialBounds.y,
            width: initialBounds.width * (dimension === "width" ? 2 : 1),
            height: initialBounds.height * (dimension === "height" ? 2 : 1),
          });
        await expect(properties.getByLabel(`Dimension ${dimension}`, { exact: true })).toHaveValue(
          String(Math.round(initialBounds[dimension] * 2)),
        );
        await expect(
          properties.getByLabel(dimension === "width" ? "Width" : "Height", { exact: true }),
        ).toHaveValue(String(Math.round(initialBounds[dimension] * 2)));

        await editor.undo();
        await expect.poll(() => editor.selectionBounds()).toEqual(initialBounds);
        await expect(properties.getByLabel(`Dimension ${dimension}`, { exact: true })).toHaveValue(
          String(Math.round(initialBounds[dimension])),
        );
      });
    }

    test(`resizes proportionally from the Scale ${dimension} field around the selected anchor`, async ({
      page,
      editor,
    }) => {
      await editor.selectAll();
      const properties = glyphProperties(page);
      const initialBounds = await editor.selectionBounds();
      await properties.getByLabel("Anchor top left", { exact: true }).click();
      await editor.commitInputValue(
        properties.getByLabel(dimension === "width" ? "Width" : "Height", { exact: true }),
        initialBounds[dimension] * 2,
      );

      await expect
        .poll(() => editor.selectionBounds())
        .toMatchObject({
          x: initialBounds.x,
          y: initialBounds.y,
          width: initialBounds.width * 2,
          height: initialBounds.height * 2,
        });
      await expect(properties.getByLabel("Width", { exact: true })).toHaveValue(
        String(Math.round(initialBounds.width * 2)),
      );
      await expect(properties.getByLabel("Height", { exact: true })).toHaveValue(
        String(Math.round(initialBounds.height * 2)),
      );
      await expect(properties.getByLabel("Dimension width", { exact: true })).toHaveValue(
        String(Math.round(initialBounds.width * 2)),
      );
      await expect(properties.getByLabel("Dimension height", { exact: true })).toHaveValue(
        String(Math.round(initialBounds.height * 2)),
      );
      await properties.getByText("Dimensions", { exact: true }).scrollIntoViewIfNeeded();
    });
  }

  test("applies scaling around the selected scale anchor", async ({ page, editor }) => {
    await editor.selectAll();
    const properties = glyphProperties(page);
    const initialBounds = await editor.selectionBounds();

    await properties.getByLabel("Anchor top left", { exact: true }).click();
    const scaleInput = properties.getByLabel("Scale factor", { exact: true });
    await editor.commitInputValue(scaleInput, 2);

    await expect
      .poll(() => editor.selectionBounds())
      .toMatchObject({
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width * 2,
        height: initialBounds.height * 2,
      });
  });

  test("keeps rotation and flipping centered regardless of the scale anchor", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const properties = glyphProperties(page);
    await properties.getByLabel("Anchor top left", { exact: true }).click();
    const initialCenter = await selectionCenter(editor);

    await properties.getByRole("button", { name: "Rotate 90 degrees clockwise" }).click();
    await expect.poll(() => selectionCenter(editor)).toEqual(initialCenter);
    const rotatedBounds = await editor.selectionBounds();

    await properties.getByRole("button", { name: "Flip horizontally" }).click();
    await expect.poll(() => editor.selectionBounds()).toEqual(rotatedBounds);
  });
});
