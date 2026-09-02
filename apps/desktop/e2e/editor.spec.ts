import type { Locator, Page } from "@playwright/test";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import { glyphProperties } from "./fixtures/appLocators";
import { CanvasUtil } from "./fixtures/CanvasUtil";

async function selectionBounds(page: Page) {
  const bounds = await page.evaluate(() => window.shift?.editor.selectionBounds());
  if (!bounds) throw new Error("Expected selection bounds");

  return bounds;
}

async function selectionCenter(page: Page) {
  const bounds = await selectionBounds(page);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function setInputValue(input: Locator, value: number): Promise<void> {
  await input.click();
  await input.fill(String(value));
  await input.press("Enter");
}

async function elementWidth(element: Locator): Promise<number> {
  return (await element.boundingBox())?.width ?? 0;
}

test.describe("Editor view", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to glyph "A" (U+0041).
    await navigateToEditor(page, "41");
  });

  test("full editor matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("editor-glyph-A.png");
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

  test("remains interactive after a renderer reload", async ({ page }) => {
    await page.reload();
    await expect(page.locator("#scene-canvas")).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Meta+a");
    await expect
      .poll(() => page.evaluate(() => window.shift?.editor.selection.ids.length ?? 0))
      .toBeGreaterThan(0);
  });

  test("composited canvas matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("editor-canvas-A.png");
  });

  test("scene canvas layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
    await expect(screenshot).toMatchSnapshot("scene-canvas-A.png");
  });

  test("background canvas layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("background-canvas");
    await expect(screenshot).toMatchSnapshot("bg-canvas-A.png");
  });

  test("GPU handles layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
    await expect(screenshot).toMatchSnapshot("handles-canvas-A.png");
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
      name: "Top-left scale anchor",
    });
    await scaleAnchor.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Top-left scale anchor");
  });

  test("keeps advance width text current after a sidebar metrics edit", async ({ page }) => {
    const properties = glyphProperties(page);
    const advanceInput = properties.getByLabel("Advance width", { exact: true });
    const rightSidebearingInput = properties.getByLabel("Right sidebearing", { exact: true });
    const initialAdvance = Number(await advanceInput.inputValue());
    const initialRightSidebearing = Number(await rightSidebearingInput.inputValue());

    await rightSidebearingInput.click();
    await rightSidebearingInput.fill(String(initialRightSidebearing + 25));
    await rightSidebearingInput.press("Enter");

    await expect(advanceInput).toHaveValue(String(initialAdvance + 25));
  });

  test("does not move a selection when its displayed position is reapplied", async ({ page }) => {
    await page.keyboard.press("Meta+a");
    const properties = glyphProperties(page);
    const xInput = properties.getByLabel("X position", { exact: true });
    const yInput = properties.getByLabel("Y position", { exact: true });
    const initialBounds = await selectionBounds(page);

    await expect(xInput).toHaveValue(String(Math.round(initialBounds.x)));
    await expect(yInput).toHaveValue(String(Math.round(initialBounds.y)));
    await xInput.press("Enter");
    await yInput.press("Enter");

    await expect.poll(() => selectionBounds(page)).toEqual(initialBounds);
  });

  test("positions a selection from its top-left independently of the scale anchor", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+a");
    const properties = glyphProperties(page);
    const xInput = properties.getByLabel("X position", { exact: true });
    const yInput = properties.getByLabel("Y position", { exact: true });
    const initialBounds = await selectionBounds(page);
    const targetX = Math.round(initialBounds.x) + 25;
    const targetY = Math.round(initialBounds.y) + 30;

    await properties.getByLabel("Top-left scale anchor", { exact: true }).click();
    await setInputValue(xInput, targetX);
    await setInputValue(yInput, targetY);

    await expect.poll(() => selectionBounds(page)).toMatchObject({ x: targetX, y: targetY });
  });

  test("applies scaling around the selected scale anchor", async ({ page }) => {
    await page.keyboard.press("Meta+a");
    const properties = glyphProperties(page);
    const initialBounds = await selectionBounds(page);

    await properties.getByLabel("Top-left scale anchor", { exact: true }).click();
    const scaleInput = properties.getByLabel("Scale factor", { exact: true });
    await setInputValue(scaleInput, 2);

    await expect
      .poll(() => selectionBounds(page))
      .toMatchObject({
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width * 2,
        height: initialBounds.height * 2,
      });
  });

  test("keeps rotation and flipping centered regardless of the scale anchor", async ({ page }) => {
    await page.keyboard.press("Meta+a");
    const properties = glyphProperties(page);
    await properties.getByLabel("Top-left scale anchor", { exact: true }).click();
    const initialCenter = await selectionCenter(page);

    await properties.getByRole("button", { name: "Rotate 90 degrees clockwise" }).click();
    await expect.poll(() => selectionCenter(page)).toEqual(initialCenter);
    const rotatedBounds = await selectionBounds(page);

    await properties.getByRole("button", { name: "Flip horizontally" }).click();
    await expect.poll(() => selectionBounds(page)).toEqual(rotatedBounds);
  });
});
