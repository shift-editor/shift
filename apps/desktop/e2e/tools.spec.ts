import { test, expect, navigateToEditor } from "./fixtures/electronApp";

/** Maps tool id to the aria-label on its toolbar button (set via tooltip). */
const TOOL_LABELS: Record<string, string> = {
  select: "Select Tool (V)",
  pen: "Pen Tool (P)",
  hand: "Hand Tool (H)",
  shape: "Shape Tool (S)",
  text: "Text Tool (T)",
};

test.describe("Toolbar tools", () => {
  test.beforeEach(async ({ workspacePage: page }) => {
    await navigateToEditor(page, "41");
  });

  test("toolbar activates each tool", async ({ workspacePage: page }) => {
    for (const label of Object.values(TOOL_LABELS)) {
      const button = page.getByRole("button", { name: label });
      await button.click();
      await expect(button).toHaveAttribute("data-active", "true");
    }
  });
});
