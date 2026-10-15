import path from "node:path";
import type { Page } from "@playwright/test";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import { glyphProperties } from "./fixtures/appLocators";

const SHAPING_TEST = path.resolve(__dirname, "../../../fixtures/fonts/ShapingTest.ufo");

test.use({ startupFontPath: SHAPING_TEST });

/** Replaces the canvas run's text; setup, not the behavior under test. */
async function setRunText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0]!;
    editor.history.capture("Set text", () =>
      editor.text.setItems(run.runId, editor.text.itemsFromText(value)),
    );
  }, text);
}

/** The glyphs the canvas run lays out, left to right. */
function runGlyphNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0]!;
    const layout = editor.text.layoutCell(run.runId).peek();
    return layout?.placedGlyphs.map((placed) => placed.glyph.glyphName) ?? [];
  });
}

test("shapes proof text through the workspace and cycles liga from the Features section", async ({
  page,
  editor,
}) => {
  await navigateToEditor(page, "0066");
  // The Text and Features sections show in Text mode only.
  await editor.selectTool("text");
  await setRunText(page, "fi");
  await expect.poll(() => runGlyphNames(page)).toEqual(["f_i"]);

  // Each click moves liga on: the font's default, forced on, forced off, then back.
  const sidebar = glyphProperties(page);
  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, Default (on)" }).click();
  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, On" }).click();
  await expect.poll(() => runGlyphNames(page)).toEqual(["f", "i"]);

  await sidebar.getByRole("button", { name: "liga, Standard Ligatures, Off" }).click();
  await expect.poll(() => runGlyphNames(page)).toEqual(["f_i"]);
  await expect(
    sidebar.getByRole("button", { name: "liga, Standard Ligatures, Default (on)" }),
  ).toBeVisible();
});

test("the shaping toggle sets the text unshaped and back", async ({ page, editor }) => {
  await navigateToEditor(page, "0066");
  // The Text section shows in Text mode only.
  await editor.selectTool("text");
  await setRunText(page, "fi");
  await expect.poll(() => runGlyphNames(page)).toEqual(["f_i"]);

  const shaping = glyphProperties(page).getByRole("button", { name: "Shaping" });
  await expect(shaping).toHaveAttribute("aria-pressed", "true");
  await shaping.click();

  await expect.poll(() => runGlyphNames(page)).toEqual(["f", "i"]);
  await expect(shaping).toHaveAttribute("aria-pressed", "false");

  await shaping.click();
  await expect.poll(() => runGlyphNames(page)).toEqual(["f_i"]);
});

test("clicking a feature tag previews the glyphs it brings in", async ({ page, editor }) => {
  await navigateToEditor(page, "0066");
  // The Features section shows in Text mode only.
  await editor.selectTool("text");

  await glyphProperties(page).getByRole("button", { name: "Preview liga" }).click();
  const preview = page.getByRole("dialog", { name: /liga/ });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "f_i" })).toBeVisible();

  await preview.getByRole("button", { name: "Close" }).click();
  await expect(preview).toBeHidden();
});

test("the Features search narrows the list by tag or name", async ({ page, editor }) => {
  await navigateToEditor(page, "0066");
  // The Features section shows in Text mode only.
  await editor.selectTool("text");
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
