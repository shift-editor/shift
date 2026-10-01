import type { Page } from "@playwright/test";
import type { GlyphName } from "@shift/types";
import { expect, recoveryTest as test } from "./fixtures/electronApp";

test.setTimeout(90_000);

test("recovers completed edits after forced termination and saves explicitly", async ({
  recoveryApp,
}) => {
  const glyphName = "recoveredE2E" as GlyphName;
  await recoveryApp.page.evaluate((name) => {
    window.shift?.editor.createGlyph(name);
  }, glyphName);
  await waitForGlyphsAndState(recoveryApp.page, [glyphName], true, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);

  const restarted = await recoveryApp.crashAndRecover();

  await waitForGlyphsAndState(restarted, [glyphName], true, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);
  await restarted.evaluate(async () => {
    await window.shiftHost?.commands.run("file.save");
  });
  await waitForGlyphsAndState(restarted, [glyphName], true, false);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);
});

test("recovers undo past the last save as a dirty document that saves explicitly", async ({
  recoveryApp,
}) => {
  const glyphName = "recoveryUndone" as GlyphName;
  await createGlyph(recoveryApp.page, glyphName);
  await waitForGlyphsAndState(recoveryApp.page, [glyphName], true, true);
  await save(recoveryApp.page);
  await waitForGlyphsAndState(recoveryApp.page, [glyphName], true, false);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);

  await recoveryApp.page.evaluate(async () => {
    await window.shift?.font.editCoordinator.undo();
  });
  await waitForGlyphsAndState(recoveryApp.page, [glyphName], false, true);

  const recovered = await recoveryApp.crashAndRecover();
  await waitForGlyphsAndState(recovered, [glyphName], false, true);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);

  await save(recovered);
  await waitForGlyphsAndState(recovered, [glyphName], false, false);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);
});

test("recovers edits made after a previous recovery", async ({ recoveryApp }) => {
  const firstGlyph = "recoveredFirst" as GlyphName;
  const secondGlyph = "recoveredSecond" as GlyphName;
  await createGlyph(recoveryApp.page, firstGlyph);
  await waitForGlyphsAndState(recoveryApp.page, [firstGlyph], true, true);

  const recovered = await recoveryApp.crashAndRecover();
  await waitForGlyphsAndState(recovered, [firstGlyph], true, true);
  await createGlyph(recovered, secondGlyph);
  await waitForGlyphsAndState(recovered, [firstGlyph, secondGlyph], true, true);

  const recoveredAgain = await recoveryApp.crashAndRecover();
  await waitForGlyphsAndState(recoveredAgain, [firstGlyph, secondGlyph], true, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(firstGlyph);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(secondGlyph);
});

/** Creates a glyph in one transaction so a single undo removes it. */
async function createGlyph(page: Page, name: GlyphName): Promise<void> {
  await page.evaluate((glyphName) => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected authored workspace");

    workspace.font.editCoordinator.transaction(`Create ${glyphName}`, () => {
      workspace.editor.createGlyph(glyphName);
    });
  }, name);
}

async function save(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.shiftHost?.commands.run("file.save");
  });
}

async function waitForGlyphsAndState(
  page: Page,
  glyphNames: GlyphName[],
  present: boolean,
  dirty: boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ names, expectedPresent, expectedDirty }) => {
      const workspace = window.shift;
      if (
        workspace?.applyStatusCell.peek() !== "idle" ||
        workspace.documentStateCell.peek()?.dirty !== expectedDirty
      ) {
        return false;
      }

      return names.every(
        (name) => (workspace.font.recordForName(name) !== null) === expectedPresent,
      );
    },
    { names: glyphNames, expectedPresent: present, expectedDirty: dirty },
    { timeout: 20_000 },
  );
}
