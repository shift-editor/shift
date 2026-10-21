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
    const run = editor.scene.only("textRun")!;
    editor.history.capture("Set text", () =>
      editor.text.setItems(run.runId, editor.text.itemsFromText(value)),
    );
  }, text);
}

/** The glyphs the canvas run lays out, left to right. */
function runGlyphNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const run = editor.scene.only("textRun")!;
    const layout = editor.text.layoutCell(run.runId).peek();
    return layout?.placedGlyphs.map((placed) => placed.glyph.glyphName) ?? [];
  });
}

/** The feature switches the Features section shows, by accessible name. */
async function featureSwitchNames(page: Page): Promise<string[]> {
  const switches = glyphProperties(page).getByRole("switch");
  const names = await switches.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  return names.filter((name) => name !== "Shaping");
}

test("shapes proof text through the workspace and turns liga off from the Features panel", async ({
  page,
}) => {
  await navigateToEditor(page, "0066");
  await setRunText(page, "fi");
  await expect.poll(() => runGlyphNames(page)).toEqual(["f_i"]);

  const liga = glyphProperties(page).getByRole("switch", { name: "liga, Standard Ligatures" });
  await expect(liga).toBeChecked();
  await liga.click();

  await expect.poll(() => runGlyphNames(page)).toEqual(["f", "i"]);
  await expect(liga).not.toBeChecked();
  await expect(
    glyphProperties(page).getByRole("button", {
      name: "Reset liga, Standard Ligatures to font default",
    }),
  ).toBeVisible();
});

test("feature search narrows the list by tag or name", async ({ page }) => {
  await navigateToEditor(page, "0066");
  await expect
    .poll(() => featureSwitchNames(page))
    .toEqual(["dlig, Discretionary Ligatures", "liga, Standard Ligatures"]);

  await glyphProperties(page).getByRole("button", { name: "Search features" }).click();
  const search = glyphProperties(page).getByRole("textbox", { name: "Search features" });
  await expect(search).toBeFocused();

  await search.fill("stand");
  await expect.poll(() => featureSwitchNames(page)).toEqual(["liga, Standard Ligatures"]);

  await search.fill("dlig");
  await expect.poll(() => featureSwitchNames(page)).toEqual(["dlig, Discretionary Ligatures"]);

  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect.poll(() => featureSwitchNames(page)).toHaveLength(2);
});
