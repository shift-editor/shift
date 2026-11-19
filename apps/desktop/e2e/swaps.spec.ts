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
  test("edits a chip in its equation, keeping text it can't read", async ({ page, editor }) => {
    await editor.openGlyphByName("dollar");
    const controls = await openVariationControls(page);
    const chips = chipsOf(controls, "dollar.heavy");

    await chips.getByRole("button", { name: "Edit Bleed ≥ 80" }).click();
    const atLeast = page.getByLabel("Bleed at least");
    await atLeast.fill("150");
    await atLeast.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Bleed only goes to 100.");
    await expect(atLeast).toHaveValue("150");

    // A range in the grammar, committed, switches the condition to at most.
    await atLeast.fill("<=90");
    await atLeast.press("Enter");
    await expect(chips.getByRole("button", { name: "Edit Bleed ≤ 90" })).toBeVisible();

    await chips.getByRole("button", { name: "Edit Bleed ≤ 90" }).click();
    await page.getByLabel("Bleed at most").fill("10");
    await page.getByLabel("Bleed at most").press("Escape");
    await expect(chips.getByRole("button", { name: "Edit Bleed ≤ 90" })).toBeVisible();
  });

  test("explains a swap an earlier one always beats, and moves it above", async ({
    page,
    editor,
  }) => {
    await editor.openGlyphByName("dollar");
    const controls = await openVariationControls(page);

    await controls.getByRole("button", { name: "Why is this swap never used?" }).click();
    const why = page.getByRole("dialog");
    await expect(why.getByText("Never used: dollar.bled always wins first.")).toBeVisible();
    await why.getByRole("button", { name: "Move above dollar.bled" }).click();

    await expect(
      controls.getByRole("button", { name: "Why is this swap never used?" }),
    ).toHaveCount(0);
  });
});
