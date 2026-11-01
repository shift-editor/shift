import type { Page } from "@playwright/test";
import { FONTS, workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { glyphProperties } from "./fixtures/appLocators";

test.use({ startupFontPath: FONTS.shapingTest });

/** Opens f, enters Text mode and types `text` over it; setup, not the behaviour under test. */
async function typeOverF(page: Page, editor: EditorDriver, text: string): Promise<void> {
  await navigateToEditor(page, "0066");
  await editor.selectTool("text");
  await expect(page.getByRole("textbox", { name: "Text input" })).toBeFocused();
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
}

/** The glyphs the canvas text draws, left to right. */
async function drawnNames(editor: EditorDriver): Promise<string[]> {
  const text = await editor.canvasText();
  return text?.glyphs.map((glyph) => glyph.name) ?? [];
}

test("cycles liga from the Features section and the text follows", async ({ page, editor }) => {
  await typeOverF(page, editor, "fi");
  await expect.poll(() => drawnNames(editor)).toEqual(["f_i"]);

  // Each click moves liga on: the font's default, forced on, forced off, then back.
  const sidebar = glyphProperties(page);
  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, Default (on)" }).click();
  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, On" }).click();
  await expect.poll(() => drawnNames(editor)).toEqual(["f", "i"]);

  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, Off" }).click();
  await expect.poll(() => drawnNames(editor)).toEqual(["f_i"]);
  await expect(
    sidebar.getByRole("button", { name: "liga, Standard Ligatures, Default (on)" }),
  ).toBeVisible();
});

test("the shaping toggle sets the text unshaped and back", async ({ page, editor }) => {
  await typeOverF(page, editor, "fi");
  await expect.poll(() => drawnNames(editor)).toEqual(["f_i"]);

  const shaping = glyphProperties(page).getByRole("button", { name: "Shaping" });
  await expect(shaping).toHaveAttribute("aria-pressed", "true");
  await shaping.click();
  await expect.poll(() => drawnNames(editor)).toEqual(["f", "i"]);
  await expect(shaping).toHaveAttribute("aria-pressed", "false");

  await shaping.click();
  await expect.poll(() => drawnNames(editor)).toEqual(["f_i"]);
});

test("clicking a feature tag previews the glyphs it brings in", async ({ page, editor }) => {
  await typeOverF(page, editor, "fi");

  await glyphProperties(page).getByRole("button", { name: "Preview liga" }).click();
  // The preview is titled with the feature's name.
  const preview = page.getByRole("dialog", { name: "Standard Ligatures" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("option", { name: "f_i" })).toBeVisible();

  await preview.getByRole("button", { name: "Close" }).click();
  await expect(preview).toBeHidden();
});

test("the Features search narrows the list by tag or name", async ({ page, editor }) => {
  await typeOverF(page, editor, "fi");
  const sidebar = glyphProperties(page);
  const liga = sidebar.getByRole("button", { name: "liga, Standard Ligatures, Default (on)" });
  const dlig = sidebar.getByRole("button", { name: /^dlig, Discretionary Ligatures, / });

  await sidebar.getByRole("button", { name: "Search features" }).click();
  const search = sidebar.getByRole("textbox", { name: "Search features" });
  await expect(search).toBeFocused();

  await search.fill("stand");
  await expect(liga).toBeVisible();
  await expect(dlig).toBeHidden();

  await search.fill("dlig");
  await expect(dlig).toBeVisible();
  await expect(liga).toBeHidden();

  await sidebar.getByRole("button", { name: "Close search" }).click();
  await expect(search).toBeHidden();
  await expect(liga).toBeVisible();
  await expect(dlig).toBeVisible();
});
