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

test("recovers batched glyph undo", async ({ recoveryApp }) => {
  const glyphNames = ["recoveryBatchA", "recoveryBatchB"] as GlyphName[];
  await recoveryApp.page.evaluate((names) => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected authored workspace");

    workspace.font.editCoordinator.transaction("Create recovery glyphs", () => {
      for (const name of names) workspace.editor.createGlyph(name);
    });
  }, glyphNames);
  await waitForGlyphsAndState(recoveryApp.page, glyphNames, true, true);
  expect(recoveryApp.canonicalGlyphNames()).not.toEqual(expect.arrayContaining(glyphNames));

  await recoveryApp.page.evaluate(async () => {
    await window.shift?.font.editCoordinator.undo();
  });
  await waitForGlyphsAndState(recoveryApp.page, glyphNames, false, false);

  await recoveryApp.page.evaluate(async () => {
    await window.shift?.font.editCoordinator.redo();
  });
  await waitForGlyphsAndState(recoveryApp.page, glyphNames, true, true);
  await save(recoveryApp.page);
  expect(recoveryApp.canonicalGlyphNames()).toEqual(expect.arrayContaining(glyphNames));

  await recoveryApp.page.evaluate(async () => {
    await window.shift?.font.editCoordinator.undo();
  });
  await waitForGlyphsAndState(recoveryApp.page, glyphNames, false, true);
  expect(recoveryApp.canonicalGlyphNames()).toEqual(expect.arrayContaining(glyphNames));

  const recovered = await recoveryApp.crashAndRecover();
  await waitForGlyphsAndState(recovered, glyphNames, false, true);
  expect(recoveryApp.canonicalGlyphNames()).toEqual(expect.arrayContaining(glyphNames));
  await save(recovered);
  expect(recoveryApp.canonicalGlyphNames()).not.toEqual(expect.arrayContaining(glyphNames));

  const followupGlyph = "recoveryAfterSave" as GlyphName;
  await recovered.evaluate((name) => {
    window.shift?.editor.createGlyph(name);
  }, followupGlyph);
  await waitForGlyphsAndState(recovered, [followupGlyph], true, true);

  const reopened = await recoveryApp.crashAndRecover();
  await waitForGlyphsAndState(reopened, [followupGlyph], true, true);
});

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
