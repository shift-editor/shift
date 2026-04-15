import { test, expect, loadFont, navigateToEditor } from "./fixtures/electronApp";

/** Maps tool id to the aria-label on its toolbar button (set via tooltip). */
const TOOL_LABELS: Record<string, string> = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  shape: "Shape Tool (S)",
  text: "Text Tool (T)",
};

test.describe("Toolbar tools", () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    await navigateToEditor(page, "41");
  });

  for (const [tool, label] of Object.entries(TOOL_LABELS)) {
    test(`${tool} tool active state matches snapshot`, async ({ page }) => {
      await page.getByRole("button", { name: label }).click();
      await page.waitForTimeout(300);

      await expect(page).toHaveScreenshot(`tool-${tool}.png`);
    });
  }
});
