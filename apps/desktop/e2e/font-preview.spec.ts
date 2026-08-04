import { previewTest as test, expect } from "./fixtures/perfApp";

test.describe("retained font source Grid preview", () => {
  test("opens through home with complete source residency and no authored workspace", async ({
    page,
  }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    const state = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[aria-label="Glyph catalog"] + canvas',
      );
      if (!canvas) throw new Error("Expected resident glyph canvas");

      return {
        mode: window.shiftSession?.mode,
        workspace: window.shiftSession?.workspace ?? null,
        authoredGlobal: window.shift ?? null,
        residentGlyphCount: Number(canvas.dataset.residentGlyphCount),
        targetGlyphCount: Number(canvas.dataset.targetGlyphCount),
      };
    });
    expect(state.mode).toBe("preview");
    expect(state.workspace).toBeNull();
    expect(state.authoredGlobal).toBeNull();
    expect(state.residentGlyphCount).toBeGreaterThan(0);
    expect(state.residentGlyphCount).toBe(state.targetGlyphCount);

    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(2);

    await scrollViewport.click({ position: { x: 50, y: 50 } });
    await page.waitForURL(/#\/editor\//);
    await expect(page.locator("#scene-canvas")).toBeVisible();
    await expect(page.locator("#marker-canvas")).toBeVisible();
    await expect(page.getByText("Advance")).toBeVisible();
  });
});
