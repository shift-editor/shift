import type { Page } from "@playwright/test";
import type { GlyphName } from "@shift/types";
import { expect, recoveryTest as test } from "./fixtures/electronApp";

test.setTimeout(60_000);

test("recovers completed edits after forced termination and saves explicitly", async ({
  recoveryApp,
}) => {
  const glyphName = "recoveredE2E" as GlyphName;
  await recoveryApp.page.evaluate((name) => {
    window.shift?.editor.createGlyph(name);
  }, glyphName);
  await waitForGlyphAndState(recoveryApp.page, glyphName, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);

  const restarted = await recoveryApp.crashAndRestart();

  await waitForGlyphAndState(restarted, glyphName, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);
  await restarted.evaluate(async () => {
    await window.shiftHost?.commands.run("file.save");
  });
  await waitForGlyphAndState(restarted, glyphName, false);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);
});

async function waitForGlyphAndState(
  page: Page,
  glyphName: GlyphName,
  dirty: boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ name, expectedDirty }) => {
      const workspace = window.shift;
      return (
        workspace?.commitStateCell.peek() === "idle" &&
        workspace.font.recordForName(name) !== null &&
        workspace.documentStateCell.peek()?.dirty === expectedDirty
      );
    },
    { name: glyphName, expectedDirty: dirty },
    { timeout: 20_000 },
  );
}
