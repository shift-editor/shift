import { expect, navigateToEditor, workspaceTest as test } from "./fixtures/electronApp";
import {
  editorShell,
  editorSidebar,
  firstAxisSlider,
  fontNavigation,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphProperties,
  openVariationControls,
  settingsDetails,
} from "./fixtures/appLocators";
import { WEIGHT } from "@/testing/fonts";

test("exposes stable semantic selectors for major application surfaces", async ({
  page,
  editor,
}) => {
  const navigation = fontNavigation(page);
  await expect(navigation).toBeVisible();
  await expect(glyphProperties(page)).toBeVisible();
  await expect(glyphCatalogSurface(page)).toBeVisible();
  await expect(glyphCatalogCanvas(page)).toBeAttached();

  const defaultSourceId = (await editor.source("default"))!.id;
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

  await editor.addAxis({ ...WEIGHT, name: "Weight" });
  await navigation.getByRole("button", { name: "Axes", exact: true }).click();
  await expect(await firstAxisSlider(page)).toBeVisible();
  await expect(page.getByLabel("Weight value", { exact: true })).toBeVisible();

  await navigateToEditor(page, "41");
  await expect(editorShell(page)).toBeVisible();
  await expect(editorSidebar(page)).toBeVisible();
  await expect(editorSidebar(page).getByRole("tab", { name: "Objects" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(await openVariationControls(page)).toBeVisible();
  await expect(glyphProperties(page)).toBeVisible();
  await expect(glyphProperties(page).getByLabel("Advance width", { exact: true })).toBeVisible();
});

test.describe("with a weight axis", () => {
  test.use({ font: { axes: [{ ...WEIGHT, name: "Weight" }] } });

  test("positions an initially hidden variation slider at its current value", async ({ page }) => {
    await navigateToEditor(page, "41");

    const controls = await openVariationControls(page);
    const slider = controls.getByRole("slider", { name: "Weight", exact: true });
    await expect(slider).toHaveValue("400");

    const normalizedPosition = await slider.evaluate((input) => {
      const thumb = input.parentElement;
      const track = thumb?.parentElement;
      if (!thumb || !track) throw new Error("Expected slider thumb and track");

      const thumbBounds = thumb.getBoundingClientRect();
      const trackBounds = track.getBoundingClientRect();
      return (thumbBounds.left + thumbBounds.width / 2 - trackBounds.left) / trackBounds.width;
    });

    expect(normalizedPosition).toBeCloseTo(0.375, 2);
  });
});
