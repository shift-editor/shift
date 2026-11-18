import { FONTS, workspaceTest as test, expect } from "./fixtures/electronApp";
import { openVariationControls, sourceRow } from "./fixtures/appLocators";

// Solenoid: `dot` has its own Spread and Strike axes and drawings at Spread
// 100 and Strike 100; `H` has none of its own.
test.use({ startupFontPath: FONTS.solenoid });

test.describe("glyph axes in the Designspace tab", () => {
  test("slides a glyph axis and edits a drawing off the font's sources", async ({
    page,
    editor,
  }) => {
    await editor.openGlyphByName("dot");
    const controls = await openVariationControls(page);

    const spread = controls.getByRole("slider", { name: "Spread", exact: true });
    await expect(spread).toBeVisible();
    await expect(controls.getByRole("slider", { name: "Strike", exact: true })).toBeVisible();

    await sourceRow(controls, "Spread 100").click();
    await expect(controls.getByLabel("Spread value")).toHaveValue("100");
    await expect.poll(async () => (await editor.editorView()).activeSourceId).toBeNull();

    await sourceRow(controls, "Regular").click();
    await expect(controls.getByLabel("Spread value")).toHaveValue("0");
  });

  test("adds a drawing where the glyph has none", async ({ page, editor }) => {
    await editor.openGlyphByName("dot");
    const controls = await openVariationControls(page);

    await editor.commitInputValue(controls.getByLabel("Spread value"), 60);
    await controls.getByLabel("Add source or drawing").click();
    await page.getByRole("menuitem", { name: /Add drawing here/ }).click();

    await expect(sourceRow(controls, "Spread 60")).toBeVisible();
  });

  test("offers a glyph without axes its first", async ({ page, editor }) => {
    await editor.openGlyphByName("H");
    const controls = await openVariationControls(page);

    await expect(controls.getByText("No axes of its own")).toBeVisible();
    await controls.getByLabel("Add glyph axis").click();
    await page.getByLabel("Name", { exact: true }).fill("Gap");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(controls.getByRole("slider", { name: "Gap", exact: true })).toBeVisible();
  });
});
