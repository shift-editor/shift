import type { Page } from "@playwright/test";
import {
  workspaceTest,
  expect,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";

const test = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });

async function outlinePixelCount(page: Page): Promise<number> {
  return page.locator("#scene-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Expected scene canvas context");

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (blue > red + 10 && red > green + 5) count++;
    }
    return count;
  });
}

test("source selection and visibility controls show comparison outlines", async ({ page }) => {
  await navigateToEditor(page, "53");
  const controls = page.getByRole("complementary", { name: "Variation controls" });
  const fixture = await page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const font = window.shiftSession!.font;
    const source = font.sources.find(({ id }) => id !== editor.activeSourceId);
    const instance = font.namedInstances[0];
    const axis = font
      .getAxes()
      .find(({ role, minimum, maximum }) => role === "external" && minimum !== maximum);
    return { source, instance, axis, activeSourceId: editor.activeSourceId };
  });
  if (!fixture.source || !fixture.instance || !fixture.axis) {
    throw new Error("Expected variable source, instance, and axis fixtures");
  }

  const baseline = await outlinePixelCount(page);
  const sourceButton = controls.getByTestId(`source-${fixture.source.id}`);
  const sourceRow = sourceButton.locator("..");
  const sourceMenu = sourceRow.getByLabel(`Actions for ${fixture.source.name}`);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect(sourceMenu).toHaveCSS("opacity", "0");
  const showSourceOutline = sourceRow.getByLabel(`Show ${fixture.source.name} outline`);
  await expect(showSourceOutline).toHaveCount(1);
  await sourceRow.hover();
  await expect(sourceMenu).toHaveCSS("opacity", "1");

  await showSourceOutline.click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.shiftSession!.editor.activeSourceId)).toBe(
    fixture.activeSourceId,
  );
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await sourceRow.hover();
  await sourceRow.getByLabel(`Hide ${fixture.source.name} outline`).click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  await sourceButton.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.shiftSession!.editor.activeSourceId)).toBe(
    fixture.activeSourceId,
  );
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await page.keyboard.press("Escape");
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  const instanceRow = controls.getByTestId(`instance-${fixture.instance.id}`).locator("..");
  await instanceRow.hover();
  await instanceRow.getByLabel(`Show ${fixture.instance.name} outline`).click();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  const showAllInstances = controls.getByLabel("Show all instance outlines");
  if (await showAllInstances.count()) await showAllInstances.click();
  await controls.getByLabel("Hide all instance outlines").click();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  const sliderBounds = await controls
    .getByRole("slider", { name: fixture.axis.name, exact: true })
    .boundingBox();
  const valueBounds = await controls
    .getByLabel(`${fixture.axis.name} value`, { exact: true })
    .boundingBox();
  const axisMenuBounds = await controls
    .getByLabel(`Actions for ${fixture.axis.name}`)
    .boundingBox();
  if (!sliderBounds || !valueBounds || !axisMenuBounds) throw new Error("Expected axis controls");
  expect(sliderBounds.x).toBeLessThan(valueBounds.x);
  expect(valueBounds.x).toBeLessThan(axisMenuBounds.x);
});
