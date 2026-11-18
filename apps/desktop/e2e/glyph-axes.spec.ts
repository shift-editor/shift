import type { Locator } from "@playwright/test";
import { FONTS, workspaceTest as test, expect } from "./fixtures/electronApp";
import { openVariationControls, sourceRow } from "./fixtures/appLocators";

// Solenoid: `dot` has its own Spread and Strike axes and glyph sources at
// Spread 100 and Strike 100; `H` has no axes of its own and a glyph source at
// Bleed 50.
test.use({ startupFontPath: FONTS.solenoid });

/** The Glyph sources section's row named `name`, as a screen reader finds it. */
function glyphSourceRow(controls: Locator, name: string): Locator {
  return controls
    .getByRole("group", { name: "Glyph sources" })
    .getByRole("button", { name, exact: true });
}

test.describe("glyph sources and glyph axes in the Designspace tab", () => {
  test("slides a glyph axis and edits a glyph source", async ({ page, editor }) => {
    await editor.openGlyphByName("dot");
    const controls = await openVariationControls(page);

    await expect(controls.getByRole("slider", { name: "Spread", exact: true })).toBeVisible();
    await expect(controls.getByRole("slider", { name: "Strike", exact: true })).toBeVisible();

    await glyphSourceRow(controls, "Spread 100").click();
    await expect(controls.getByLabel("Spread value")).toHaveValue("100");
    await expect.poll(async () => (await editor.editorView()).activeSourceId).toBeNull();

    await sourceRow(controls, "Regular").click();
    await expect(controls.getByLabel("Spread value")).toHaveValue("0");
  });

  test("adds a glyph source where the glyph has none", async ({ page, editor }) => {
    await editor.openGlyphByName("dot");
    const controls = await openVariationControls(page);

    await editor.commitInputValue(controls.getByLabel("Spread value"), 60);
    await controls.getByLabel("Add glyph source or axis").click();
    await page.getByRole("menuitem", { name: "Add glyph source at Spread 60" }).click();

    await expect(glyphSourceRow(controls, "Spread 60")).toBeVisible();
  });

  test("adds a glyph's first axis from Glyph sources", async ({ page, editor }) => {
    await editor.openGlyphByName("H");
    const controls = await openVariationControls(page);

    await expect(controls.getByRole("slider", { name: "Gap", exact: true })).toHaveCount(0);
    await controls.getByLabel("Add glyph source or axis").click();
    await page.getByRole("menuitem", { name: "Add glyph axis…" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Gap");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(controls.getByRole("slider", { name: "Gap", exact: true })).toBeVisible();
  });
});
