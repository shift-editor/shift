import { expect, navigateToEditor, workspaceTest as test } from "./fixtures/electronApp";
import {
  editorShell,
  firstAxisSlider,
  fontNavigation,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphProperties,
  settingsDetails,
  variationControls,
} from "./fixtures/appLocators";

test("exposes stable semantic selectors for major application surfaces", async ({ page }) => {
  const navigation = fontNavigation(page);
  await expect(navigation).toBeVisible();
  await expect(glyphProperties(page)).toBeVisible();
  await expect(glyphCatalogSurface(page)).toBeVisible();
  await expect(glyphCatalogCanvas(page)).toBeAttached();

  const defaultSourceId = await page.evaluate(() => window.shift?.font.defaultSource.id);
  if (!defaultSourceId) throw new Error("Expected default source");
  await navigation.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(page.getByTestId(`source-${defaultSourceId}`)).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
  await expect(settingsDetails(page)).toBeVisible();
  await settings.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(page.getByTestId(`settings-source-${defaultSourceId}`)).toBeVisible();
  await settings.getByLabel("Close settings").click();
  await expect(settings).toBeHidden();

  await page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
  });
  await navigation.getByRole("button", { name: "Axes", exact: true }).click();
  await expect(await firstAxisSlider(page)).toBeVisible();
  await expect(page.getByLabel("Weight value", { exact: true })).toBeVisible();

  await navigateToEditor(page, "41");
  await expect(editorShell(page)).toBeVisible();
  await expect(variationControls(page)).toBeVisible();
  await expect(glyphProperties(page)).toBeVisible();
  await expect(glyphProperties(page).getByLabel("Advance width", { exact: true })).toBeVisible();
});
