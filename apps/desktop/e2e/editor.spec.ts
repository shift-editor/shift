import { test, expect, navigateToEditor } from "./fixtures/electronApp";

test.describe("Editor view", () => {
  test.beforeEach(async ({ workspacePage: page }) => {
    // Navigate to glyph "A" (U+0041).
    await navigateToEditor(page, "41");
  });

  test("full editor matches snapshot", async ({ workspacePage: page }) => {
    await expect(page).toHaveScreenshot("editor-glyph-A.png");
  });
});
