import type { ElectronApplication, Page } from "@playwright/test";
import {
  workspaceTest,
  documentTest,
  expect,
  FONT_PATH,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";
import { clickFirstCatalogGlyph } from "./fixtures/appLocators";

const authoredTest = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });
const previewTest = documentTest.extend({ openFontPath: [FONT_PATH, { option: true }] });

async function handlePixels(page: Page, electronApp: ElectronApplication) {
  const screenshot = await page.locator("#marker-canvas").screenshot({
    style:
      "#background-canvas, #scene-canvas, #interactive-canvas { visibility: hidden; } #marker-canvas { background: white; }",
  });
  return electronApp.evaluate(({ nativeImage }, png) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(png, "base64")).toBitmap();
    let blue = 0;
    let neutral = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const b = pixels[index]!;
      const g = pixels[index + 1]!;
      const r = pixels[index + 2]!;
      if (b > r + 60 && g > r + 40) blue++;
      if (r < 250 && r === g && g === b) neutral++;
    }
    return { blue, neutral };
  }, screenshot.toString("base64"));
}

authoredTest(
  "handles remain visible while scrubbing and use source-location styling",
  async ({ page, electronApp }) => {
    await navigateToEditor(page, "53");
    await expect.poll(async () => (await handlePixels(page, electronApp)).blue).toBeGreaterThan(0);
    const controls = page.getByRole("complementary", { name: "Variation controls" });
    await controls.getByRole("button", { name: "Sources", exact: true }).click();
    await controls.getByRole("button", { name: "Instances", exact: true }).click();
    const slider = controls.getByRole("slider", { name: "width", exact: true });
    const bounds = await slider.boundingBox();
    if (!bounds) throw new Error("Expected width slider bounds");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    try {
      for (const fraction of [1.5, 2, 2.5]) {
        await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2, {
          steps: 3,
        });
        await expect
          .poll(() => page.evaluate(() => window.shiftSession!.editor.activeSourceId))
          .toBeNull();
        await expect.poll(async () => (await handlePixels(page, electronApp)).blue).toBe(0);
        await expect
          .poll(async () => (await handlePixels(page, electronApp)).neutral)
          .toBeGreaterThan(0);
      }
    } finally {
      await page.mouse.up();
    }
    await slider.focus();
    await slider.press("Home");
    await expect.poll(async () => (await handlePixels(page, electronApp)).blue).toBeGreaterThan(0);
  },
);

authoredTest(
  "named instances between sources use interpolated handle outlines",
  async ({ page, electronApp }) => {
    await navigateToEditor(page, "53");
    const instance = await page.evaluate(() => {
      const font = window.shiftSession!.font;
      return font.namedInstances.find(
        (instance) =>
          !font.sourceAt(
            new Map(
              font
                .getAxes()
                .map((axis) => [axis.id, instance.location.values[axis.id] ?? axis.default]),
            ),
          ),
      );
    });
    if (!instance) throw new Error("Expected an instance between sources");
    const controls = page.getByRole("complementary", { name: "Variation controls" });
    await controls.getByRole("button", { name: "Sources", exact: true }).click();
    await controls.getByTestId(`instance-${instance.id}`).click();

    await expect.poll(async () => (await handlePixels(page, electronApp)).blue).toBe(0);
    await expect
      .poll(async () => (await handlePixels(page, electronApp)).neutral)
      .toBeGreaterThan(0);
  },
);

previewTest(
  "TTF source handles retain their normal color without becoming selectable",
  async ({ page, electronApp }) => {
    const window = electronApp.waitForEvent("window");
    await page.getByRole("button", { name: /Load font/ }).click();
    const workspacePage = await window;
    await workspacePage.waitForURL(/#\/home$/);
    await clickFirstCatalogGlyph(workspacePage);
    await expect
      .poll(async () => (await handlePixels(workspacePage, electronApp)).blue)
      .toBeGreaterThan(0);

    const point = await workspacePage.evaluate(() => {
      const editor = window.shiftSession!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const point = editor.glyphForId(node.glyphId)!.geometryAt(editor.externalLocation)
        .allPoints[0]!;
      return editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
    });
    const bounds = await workspacePage.locator("#interactive-canvas").boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");
    await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);
    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession!.editor.hover.id))
      .toBeNull();
    expect((await handlePixels(workspacePage, electronApp)).blue).toBeGreaterThan(0);
  },
);
