import type { Locator, Page } from "@playwright/test";
import type { AnchorId } from "@shift/types";
import { line, type ShapeFixture } from "@/testing/fixtures";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  editorSidebar,
  editorToolbar,
  elementWidth,
  glyphProperties,
} from "./fixtures/appLocators";
import { firstSegmentMidpoint, lineSegmentUpgrade } from "./fixtures/editorInteractions";
import {
  expectCanvasSnapshot,
  expectPanelSnapshot,
  expectPageSnapshot,
} from "./fixtures/snapshots";
import { resizeWindowContent } from "./fixtures/window";
import { localPoint } from "@shift/editor/spaces";

/** The points the object-tree test names among the lines it draws. */
type TreePoint = "first" | "last" | "destination" | "focusedFirst";

/** Opens A and returns three distinct fixture points for alignment scenarios. */
async function alignmentFixture(editor: EditorDriver) {
  await editor.openGlyphByUnicode("41");
  const outline = await editor.outline();
  const available = outline.flatMap((contour) => contour.points);
  const first = available[0];
  // The golden shows A, so pick three of its own points that differ in x and y.
  // oxlint-disable-next-line shift/no-lookup-in-tests -- picks a point by position for the golden, not a record by key
  const second = available.find((point) => point.x !== first?.x && point.y !== first?.y);
  // oxlint-disable-next-line shift/no-lookup-in-tests -- picks a point by position for the golden, not a record by key
  const third = available.find((point) => point.id !== first?.id && point.id !== second?.id);
  if (!first || !second || !third) throw new Error("Expected three distinct fixture points");

  return editor.pointTargets([first.id, second.id, third.id]);
}

test(
  "enables alignment for two selected points while distribution still requires three",
  { tag: "@golden" },
  async ({ page, editor }) => {
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
  },
);

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
  const initialBounds = await editor.selectionBounds();
  const down = await editor.projectGlyphToPage(
    localPoint(initialBounds.right, initialBounds.bottom),
  );
  const normal = await editor.projectGlyphToPage(
    localPoint(
      initialBounds.right + initialBounds.width * 0.1,
      initialBounds.bottom + initialBounds.height * 0.02,
    ),
  );
  const centered = await editor.projectGlyphToPage(
    localPoint(
      initialBounds.right + initialBounds.width * 0.15,
      initialBounds.bottom + initialBounds.height * 0.03,
    ),
  );
  const crossed = await editor.projectGlyphToPage(
    localPoint(
      initialBounds.x + initialBounds.width * 0.25,
      initialBounds.bottom + initialBounds.height * 0.03,
    ),
  );

  await page.mouse.move(down.x, down.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  try {
    await page.mouse.move(normal.x, normal.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect.poll(() => editor.toolState()).toBe("resizing");

    await page.keyboard.down("Alt");
    await page.mouse.move(centered.x, centered.y, { steps: 3 });
    await editor.flushPointerMoves();
    const preview = await editor.selectionBounds();
    expect(preview.width / initialBounds.width).toBeCloseTo(1.3);
    expect(preview.height / initialBounds.height).toBeCloseTo(1.3);
    expect(preview.x + preview.width / 2).toBeCloseTo(initialBounds.x + initialBounds.width / 2);
    expect(preview.y + preview.height / 2).toBeCloseTo(initialBounds.y + initialBounds.height / 2);
    await expect(canvas).toHaveCSS("cursor", /nesw-resize$/);

    await page.mouse.move(crossed.x, crossed.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect(canvas).toHaveCSS("cursor", /nwse-resize$/);
    await page.mouse.move(centered.x, centered.y, { steps: 3 });
    await editor.flushPointerMoves();
    await expect(canvas).toHaveCSS("cursor", /nesw-resize$/);
    expect(await editor.selectionBounds()).toEqual(preview);

    await page.keyboard.up("Alt");
    await page.mouse.move(normal.x, normal.y, { steps: 3 });
    await editor.flushPointerMoves();
    const uncentered = await editor.selectionBounds();
    expect(uncentered.x).toBeCloseTo(initialBounds.x);
    expect(uncentered.y).toBeCloseTo(initialBounds.y);
    expect(uncentered.width / initialBounds.width).toBeCloseTo(1.1);
    expect(uncentered.height / initialBounds.height).toBeCloseTo(1.1);

    await page.keyboard.down("Alt");
    await page.mouse.move(centered.x, centered.y, { steps: 3 });
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

/** True when the element is the topmost hit target at `offsetX` from its left edge. */
async function receivesPointerAt(element: Locator, offsetX: number): Promise<boolean> {
  return element.evaluate((node, offset) => {
    const bounds = node.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + offset, bounds.y + bounds.height / 2);

    return hit === node;
  }, offsetX);
}

/** Resizes a focused divider one keyboard step, which persists the layout like a drag does. */
async function nudgeDivider(page: Page, divider: Locator, key: string) {
  await divider.focus();
  await page.keyboard.press(key);
}

test.describe("Editor view", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("41");
  });

  test(
    "selects displayed glyph objects from the Objects tab",
    { tag: "@golden" },
    async ({ page, editor }) => {
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

      await editor.undo();
      await expect
        .poll(() => editor.selectionIds())
        .toEqual([firstPoint.id, secondPoint.id, thirdPoint.id, fourthPoint.id]);

      await editor.redo();
      await expect.poll(() => editor.selectionIds()).toEqual([contour.id]);
    },
  );

  test("keeps the object tree usable without mounting offscreen points", async ({
    page,
    editor,
  }) => {
    // 120 open two-point lines; the 26th is the one keyboard navigation reaches.
    // The names the test needs, by line index: each line's start point, then its end point.
    const startNames = new Map<number, TreePoint>([
      [0, "first"],
      [25, "focusedFirst"],
    ]);
    const endNames = new Map<number, TreePoint>([
      [25, "destination"],
      [119, "last"],
    ]);
    const lines: ShapeFixture<TreePoint>[] = Array.from({ length: 120 }, (_, index) =>
      line<TreePoint>(
        { x: index * 20, y: 0, name: startNames.get(index) },
        { x: index * 20 + 10, y: 10, name: endNames.get(index) },
      ),
    );
    const drawn = await editor.draw({ contours: lines });
    const { first: firstId, last: lastId } = drawn;
    await editor.waitForIdle();
    await editor.waitForCanvasRender();

    const objects = page.getByRole("navigation", { name: "Glyph objects" });
    const rows = objects.locator('[data-testid^="object-"]');
    await expect(objects.getByTestId(`object-${firstId}`)).toBeVisible();
    expect(await rows.count()).toBeLessThan(100);
    await objects.getByTestId(`object-${firstId}`).click();
    await objects.evaluate((nav) => {
      if (!nav.parentElement) throw new Error("Objects scroll container is missing");
      nav.parentElement.scrollTop = nav.parentElement.scrollHeight;
    });
    await expect(objects.getByTestId(`object-${lastId}`)).toBeVisible();
    await expect(objects.getByTestId(`object-${firstId}`)).toHaveCount(0);
    await objects.getByTestId(`object-${lastId}`).click({ modifiers: ["Shift"] });

    const outline = await editor.outline();
    const start = outline.findIndex((contour) => contour.points[0]?.id === firstId);
    expect(start).toBeGreaterThanOrEqual(0);
    const expected = outline
      .slice(start)
      .flatMap((contour, index) => [
        ...(index === 0 ? [] : [contour.id]),
        ...contour.points.map((point) => point.id),
      ]);
    await expect.poll(() => editor.selectionIds()).toEqual(expected);
    expect(await rows.count()).toBeLessThan(100);

    await objects.evaluate((nav) => {
      if (!nav.parentElement) throw new Error("Objects scroll container is missing");
      nav.parentElement.scrollTop = 0;
    });
    const { destination } = drawn;
    await objects.getByTestId(`object-${firstId}`).click();
    const tree = objects.getByRole("tree", { name: "Contours" });
    await expect(tree).toBeFocused();
    for (let index = 0; index < 76; index++) await page.keyboard.press("ArrowDown");
    await expect(tree).toHaveAttribute("aria-activedescendant", `object-tree-${destination}`);
    await expect(objects.getByTestId(`object-${destination}`)).toBeVisible();
    // destination ends the 26th line drawn.
    const focusedContour = outline[start + 25]!;
    expect(focusedContour.points.map((point) => point.id)).toContain(destination);
    await page.keyboard.press("ArrowLeft");
    await expect(tree).toHaveAttribute("aria-activedescendant", `object-tree-${focusedContour.id}`);
    await page.keyboard.press("ArrowLeft");
    await expect(
      objects
        .getByRole("treeitem")
        .filter({ has: page.getByTestId(`object-${focusedContour.id}`) }),
    ).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(objects.getByTestId(`object-${focusedContour.id}`)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const firstChildId = drawn.focusedFirst;
    await expect(tree).toHaveAttribute("aria-activedescendant", `object-tree-${firstChildId}`);
    await page.keyboard.press(" ");
    await expect.poll(() => editor.selectionIds()).toEqual([firstId, firstChildId]);
    await page.keyboard.press("Delete");
    await editor.waitForIdle();
    await expect(tree).toHaveAttribute("aria-activedescendant", `object-tree-${focusedContour.id}`);
    await page.keyboard.press("Tab");
    await expect(tree).not.toBeFocused();
  });

  test("edits anchor X and Y positions without restoring stale coordinates", async ({
    page,
    editor,
  }) => {
    await editor.openGlyphByName("E");
    await editor.addAnchorAt({ x: 200, y: 700 });
    const [anchorId] = (await editor.selectionIds()) as AnchorId[];
    if (!anchorId) throw new Error("Expected the added anchor to be selected");
    await editor.renameAnchor(anchorId, "top");
    await editor.waitForIdle();
    const anchorRow = editorSidebar(page).getByTestId(`object-${anchorId}`);
    await expect(anchorRow).toBeVisible();
    await anchorRow.click();

    expect(await editor.selectionIds()).toEqual([anchorId]);
    const anchorPosition = async () => {
      const anchor = await editor.anchorNamed("top");
      if (!anchor) throw new Error("Expected the added anchor");

      return { x: anchor.x, y: anchor.y };
    };
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

  test("full editor matches snapshot", { tag: "@golden" }, async ({ page, editor }) => {
    await editor.waitForCanvasRender();
    await page.mouse.move(0, 0);
    await expectPageSnapshot(page, "editor-glyph-A.png", [editorToolbar(page)]);
  });

  test("resets sidebars to their default width on divider double-click", async ({ page }) => {
    const layout = page.getByTestId("editor-layout-panels");
    const leftSidebar = layout.getByTestId("editor-left-sidebar");
    const rightSidebar = layout.getByTestId("editor-right-sidebar");
    const leftDivider = layout.getByRole("separator", { name: "Resize left sidebar" });
    const rightDivider = layout.getByRole("separator", { name: "Resize right sidebar" });
    const defaultLeftWidth = 240;
    const defaultRightWidth = 260;

    await leftDivider.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => elementWidth(leftSidebar)).toBeGreaterThan(defaultLeftWidth);
    await leftDivider.dispatchEvent("dblclick");
    await expect.poll(() => elementWidth(leftSidebar)).toBeCloseTo(defaultLeftWidth, 0);

    await rightDivider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => elementWidth(rightSidebar)).toBeGreaterThan(defaultRightWidth);
    await rightDivider.dispatchEvent("dblclick");
    await expect.poll(() => elementWidth(rightSidebar)).toBeCloseTo(defaultRightWidth, 0);
    await expect.poll(() => elementWidth(leftSidebar)).toBeCloseTo(defaultLeftWidth, 0);
  });

  test("keeps sidebar widths when the window resizes", async ({ electronApp, page, editor }) => {
    await editor.waitForCanvasRender();
    const layout = page.getByTestId("editor-layout-panels");
    const leftSidebar = layout.getByTestId("editor-left-sidebar");
    const rightSidebar = layout.getByTestId("editor-right-sidebar");
    const canvas = layout.getByTestId("canvas");
    const leftWidth = await elementWidth(leftSidebar);
    const rightWidth = await elementWidth(rightSidebar);
    const canvasWidth = await elementWidth(canvas);

    const resizeWindow = (delta: number) => resizeWindowContent(electronApp, delta);

    // The test window is already at its minimum size, so grow it.
    await resizeWindow(200);
    try {
      await expect.poll(() => elementWidth(canvas)).toBeCloseTo(canvasWidth + 200, 0);
      expect(await elementWidth(leftSidebar)).toBeCloseTo(leftWidth, 0);
      expect(await elementWidth(rightSidebar)).toBeCloseTo(rightWidth, 0);
    } finally {
      await resizeWindow(-200);
    }
  });

  test("keeps the whole divider grab area above the canvas", async ({ page, editor }) => {
    await editor.waitForCanvasRender();
    const layout = page.getByTestId("editor-layout-panels");

    for (const name of ["Resize left sidebar", "Resize right sidebar"]) {
      const divider = layout.getByRole("separator", { name });
      const width = (await divider.boundingBox())?.width ?? 0;
      expect(width).toBeGreaterThan(8);

      for (const offsetX of [1, width / 2, width - 1]) {
        expect(await receivesPointerAt(divider, offsetX)).toBe(true);
      }
    }
  });

  test("shares sidebar widths between the catalog and the editor", async ({ page, editor }) => {
    await editor.waitForCanvasRender();
    const editorLayout = page.getByTestId("editor-layout-panels");
    const homeLayout = page.getByTestId("home-layout-panels");
    const editorSidebarPanel = editorLayout.getByTestId("editor-left-sidebar");
    const homeSidebarPanel = homeLayout.getByTestId("home-left-sidebar");
    const initialWidth = await elementWidth(editorSidebarPanel);

    await nudgeDivider(
      page,
      editorLayout.getByRole("separator", { name: "Resize left sidebar" }),
      "ArrowRight",
    );
    await expect.poll(() => elementWidth(editorSidebarPanel)).toBeGreaterThan(initialWidth + 1);
    const widenedWidth = await elementWidth(editorSidebarPanel);

    await page.getByRole("button", { name: "Font overview", exact: true }).click();
    await page.waitForURL(/#\/home/);
    await expect.poll(() => elementWidth(homeSidebarPanel)).toBeCloseTo(widenedWidth, 0);

    await nudgeDivider(
      page,
      homeLayout.getByRole("separator", { name: "Resize left sidebar" }),
      "ArrowLeft",
    );
    await expect.poll(() => elementWidth(homeSidebarPanel)).toBeLessThan(widenedWidth - 1);
    const narrowedWidth = await elementWidth(homeSidebarPanel);

    await editor.openGlyphByUnicode("41");
    await expect.poll(() => elementWidth(editorSidebarPanel)).toBeCloseTo(narrowedWidth, 0);
  });

  test("toolbar toggles both sidebars without reflowing their contents", async ({ page }) => {
    const layout = page.getByTestId("editor-layout-panels");
    const leftPanel = layout.getByTestId("editor-left-sidebar");
    const rightPanel = layout.getByTestId("editor-right-sidebar");
    const leftContent = editorSidebar(page);
    const rightContent = page.getByRole("complementary", { name: "Glyph properties" });

    if ((await elementWidth(leftPanel)) <= 1) {
      await page.getByRole("button", { name: "Toggle left sidebar" }).click();
      await expect.poll(() => elementWidth(leftPanel)).toBeGreaterThan(0);
    }

    if ((await elementWidth(rightPanel)) <= 1) {
      await page.getByRole("button", { name: "Toggle right sidebar" }).click();
      await expect.poll(() => elementWidth(rightPanel)).toBeGreaterThan(0);
    }

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
    const down = await firstSegmentMidpoint(page);

    await canvas.hover({ position: down });
    await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
    await page.keyboard.down("Alt");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
    } finally {
      await page.keyboard.up("Alt");
    }
    await page.keyboard.down("Meta");
    try {
      await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
      for (const sidebar of [editorSidebar(page), glyphProperties(page)]) {
        await sidebar.hover({ position: { x: 10, y: 10 } });
        await expect(sidebar).not.toHaveCSS("cursor", /cursors\//);
      }
    } finally {
      await page.keyboard.up("Meta");
    }
    await canvas.click({ position: down, modifiers: ["Meta"] });
    await editor.waitForIdle();
    await canvas.click({ position: { x: 10, y: 10 } });
    await editor.waitForIdle();

    try {
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
    }
    await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
  });

  test(
    "previews upgrade handles on Cmd-hover and commits those positions on Cmd-click",
    { tag: "@golden" },
    async ({ page, editor }) => {
      const canvas = editor.canvas;
      const preview = await lineSegmentUpgrade(page);
      // The handles the Select tool previews, in glyph units; null means none is drawn.
      const previewHandles = () => editor.drawnUpgradePreview();

      await canvas.hover({ position: preview.hover });
      await expect.poll(previewHandles).toBeNull();
      await page.keyboard.down("Meta");
      try {
        await expect(canvas).toHaveCSS("cursor", /cursor@32-bend\.svg/);
        await expect.poll(previewHandles).toEqual(preview.controls);
        await expectCanvasSnapshot(editor, "segment-upgrade-preview.png");

        await page.keyboard.up("Meta");
        await expect.poll(previewHandles).toBeNull();
        await page.keyboard.down("Meta");
        await expect.poll(previewHandles).toEqual(preview.controls);
        await glyphProperties(page).hover({ position: { x: 10, y: 10 } });
        await expect.poll(previewHandles).toBeNull();
        await canvas.hover({ position: preview.hover });
        await expect.poll(previewHandles).toEqual(preview.controls);

        await canvas.click({ position: preview.hover });
        await editor.waitForIdle();
        // The committed curve's controls sit where the preview drew them.
        expect((await editor.outline())[0]!.points).toEqual(
          expect.arrayContaining(
            preview.controls.map(({ x, y }) =>
              expect.objectContaining({
                x: expect.closeTo(x, 6),
                y: expect.closeTo(y, 6),
                pointType: "offCurve",
              }),
            ),
          ),
        );
        await expect.poll(previewHandles).toBeNull();
        await expect(canvas).toHaveCSS("cursor", /cursor@32\.svg/);
      } finally {
        await page.keyboard.up("Meta");
      }
    },
  );

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

  test("composited canvas matches snapshot", { tag: "@golden" }, async ({ editor }) => {
    await expectCanvasSnapshot(editor, "editor-canvas-A.png");
  });

  test("shows Boolean operations for two completely selected contours", async ({ page }) => {
    await page.keyboard.press("Meta+a");

    await expect(glyphProperties(page).getByText("Boolean", { exact: true })).toBeVisible();
  });

  test("explains icon-only editor actions on hover", async ({ page }) => {
    const toolbar = editorToolbar(page);
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

  test("keeps the zoom button the same width while the zoom percentage changes", async ({
    page,
    editor,
  }) => {
    const zoomButton = page.getByRole("button", { name: /^Zoom options, / });
    const widths: number[] = [];

    for (const zoom of [0.53, 0.57, 0.64]) {
      await editor.setZoom(zoom);
      await expect(zoomButton).toHaveAccessibleName(`Zoom options, ${Math.round(zoom * 100)}%`);
      widths.push(await elementWidth(zoomButton));
    }

    expect(widths.map((width) => width.toFixed(2))).toEqual(Array(3).fill(widths[0]!.toFixed(2)));
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

  test("steps a position with the arrow keys and drops typed text on Escape", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const xInput = glyphProperties(page).getByLabel("X position", { exact: true });
    const initialX = Math.round((await editor.selectionBounds()).x);

    await xInput.click();
    await xInput.press("ArrowUp");
    await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: initialX + 1 });
    await xInput.press("Shift+ArrowUp");
    await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: initialX + 11 });
    await xInput.press("ControlOrMeta+ArrowUp");
    await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: initialX + 111 });
    await xInput.press("ControlOrMeta+ArrowDown");
    await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: initialX + 11 });

    await xInput.fill(String(initialX + 500));
    await xInput.press("Escape");

    await expect(xInput).toHaveValue(String(initialX + 11));
    await expect(xInput).not.toBeFocused();
    expect(await editor.selectionBounds()).toMatchObject({ x: initialX + 11 });
  });

  // Release geometry with Shift held or released is owned by behaviour/select/resize-selection.test.ts.
  // This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
  test("keeps constrained drag geometry when Shift is released before mouseup", async ({
    page,
    editor,
  }) => {
    await editor.selectAll();
    const initialBounds = await editor.selectionBounds();
    const down = await editor.projectGlyphToPage(
      localPoint(initialBounds.right, initialBounds.bottom),
    );
    const end = await editor.projectGlyphToPage(
      localPoint(
        initialBounds.right + initialBounds.width * 0.15,
        initialBounds.bottom + initialBounds.height * 0.03,
      ),
    );

    await page.mouse.move(down.x, down.y);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    try {
      await page.mouse.move(end.x, end.y, { steps: 3 });
      await editor.flushPointerMoves();
      await expect.poll(() => editor.toolState()).toBe("resizing");
      const preview = await editor.selectionBounds();
      expect(preview.width).toBeGreaterThan(initialBounds.width);
      expect(preview.width / initialBounds.width).toBeCloseTo(
        preview.height / initialBounds.height,
      );

      await page.keyboard.up("Shift");
      await page.mouse.up();
      await editor.waitForIdle();

      expect(await editor.selectionBounds()).toEqual(preview);
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Shift");
    }
  });

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
