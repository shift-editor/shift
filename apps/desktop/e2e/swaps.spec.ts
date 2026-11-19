import type { Locator } from "@playwright/test";
import { FONTS, workspaceTest as test, expect } from "./fixtures/electronApp";
import { openVariationControls } from "./fixtures/appLocators";

// Solenoid: `dollar` draws `dollar.bled` from Bleed 70, then `dollar.heavy`
// from 80, which `dollar.bled` always beats.
test.use({ startupFontPath: FONTS.solenoid });

/** The chips of the swap drawing `glyph`, as a screen reader finds them. */
function chipsOf(controls: Locator, glyph: string): Locator {
  return controls.getByRole("group", { name: `${glyph} condition` });
}

test.describe("swaps in the Designspace tab", () => {
  test("edits a chip in place, keeping text it can't read", async ({ page, editor }) => {
    await editor.openGlyphByName("dollar");
    const controls = await openVariationControls(page);
    const chips = chipsOf(controls, "dollar.heavy");

    await chips.getByRole("button", { name: "Edit Bleed ≥ 80" }).click();
    const field = chips.getByLabel("Bleed condition");
    await field.fill("150");
    await field.press("Enter");
    await expect(controls.getByRole("alert")).toHaveText("Bleed only goes to 100.");
    await expect(field).toHaveValue("150");

    await field.fill("<=90");
    await field.press("Enter");
    await expect(chips.getByRole("button", { name: "Edit Bleed ≤ 90" })).toBeVisible();

    await chips.getByRole("button", { name: "Edit Bleed ≤ 90" }).click();
    await chips.getByLabel("Bleed condition").fill("10");
    await chips.getByLabel("Bleed condition").press("Escape");
    await expect(chips.getByRole("button", { name: "Edit Bleed ≤ 90" })).toBeVisible();
  });

  test("notes a swap an earlier one always beats", async ({ page, editor }) => {
    await editor.openGlyphByName("dollar");
    const controls = await openVariationControls(page);

    await expect(
      controls.getByText("Never used: dollar.bled above always wins first. Drag it below."),
    ).toBeVisible();
  });
});
