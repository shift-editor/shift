import type { Page } from "@playwright/test";

/** Ensures main has a view-resume payload matching the current editor route. */
export async function persistCurrentEditorRoute(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const glyphId = window.location.hash.match(/#\/editor\/([^/?]+)/)?.[1];
    if (!glyphId || !window.shift) return;

    const decoded = decodeURIComponent(glyphId);
    const record = window.shift.font.glyphRecords().find((glyph) => glyph.id === decoded);
    if (!record) return;

    await window.shiftHost?.session.setViewResume({
      route: {
        glyphName: record.name,
        unicode: record.unicodes[0] ?? null,
        glyphId: record.id,
      },
      catalog: {
        query: "",
        categoryFilters: [],
        selectedLanguageId: null,
        scrollTop: 0,
      },
    });
  });
}

export async function waitForAuthoredFontLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => window.shift?.font.loaded === true, undefined, {
    timeout: 20_000,
  });
}
