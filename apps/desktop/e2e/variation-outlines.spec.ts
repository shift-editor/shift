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

test("variation rows toggle source and instance outlines", async ({ page }) => {
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
    return { source, instance, axis };
  });
  if (!fixture.source || !fixture.instance || !fixture.axis) {
    throw new Error("Expected variable source, instance, and axis fixtures");
  }

  const baseline = await outlinePixelCount(page);
  const sourceRow = controls.getByTestId(`source-${fixture.source.id}`).locator("..");
  const sourceMenu = sourceRow.getByLabel(`Actions for ${fixture.source.name}`);
  const sourceEye = sourceRow.getByLabel(`Show ${fixture.source.name} outline`);
  await expect(sourceEye).toHaveCSS("opacity", "0");
  await expect(sourceMenu).toHaveCSS("opacity", "0");
  await expect(controls.getByLabel("Show all source outlines")).toHaveCSS("opacity", "0");
  await sourceRow.hover();
  await expect(sourceEye).toHaveCSS("opacity", "1");
  await expect(sourceMenu).toHaveCSS("opacity", "1");
  const [menuBounds, eyeBounds] = await Promise.all([
    sourceMenu.boundingBox(),
    sourceEye.boundingBox(),
  ]);
  if (!menuBounds || !eyeBounds) throw new Error("Expected source actions");
  expect(eyeBounds.x).toBeLessThan(menuBounds.x);

  await sourceEye.click();
  await page.locator("#scene-canvas").hover();
  const activeSourceEye = sourceRow.getByLabel(`Hide ${fixture.source.name} outline`);
  await expect(activeSourceEye).toHaveCSS("opacity", "1");
  await expect(sourceMenu).toHaveCSS("opacity", "0");
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await controls.getByLabel("Show all source outlines").click();
  await page.locator("#scene-canvas").hover();
  await expect(controls.getByLabel("Hide all source outlines")).toHaveCSS("opacity", "1");
  await expect(activeSourceEye).toHaveCSS("opacity", "1");
  await controls.getByLabel("Hide all source outlines").click();
  const inactiveSourceEye = sourceRow.getByLabel(`Show ${fixture.source.name} outline`);
  await expect(inactiveSourceEye.locator("path")).toHaveAttribute("fill", "#585858");
  await expect(inactiveSourceEye).toHaveCSS("opacity", "0");
  await expect(inactiveSourceEye.locator("path")).toHaveAttribute("stroke", "#585858");
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
