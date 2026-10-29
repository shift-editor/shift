import type { ElectronApplication, Page } from "@playwright/test";
import { EditorDriver } from "./fixtures/EditorDriver";
import { waitForEditorReady } from "./fixtures/appLocators";
import { createGlyphNamed, runWindowCommand } from "./fixtures/documentLifecycle";
import { expect, recoveryTest as test } from "./fixtures/electronApp";

test.setTimeout(90_000);

test(
  "recovers completed edits after forced termination and saves explicitly",
  { tag: "@os" },
  async ({ recoveryApp }) => {
    const glyphName = "recoveredE2E";
    await createGlyphNamed(recoveryApp.page, glyphName);
    await expectGlyphsAndState(recoveryApp.page, recoveryApp.app, [glyphName], true, true);
    expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);

    const restarted = await recoveryApp.crashAndRecover();

    await expectGlyphsAndState(restarted, recoveryApp.app, [glyphName], true, true);
    expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);
    await runWindowCommand(restarted, "file.save");
    await expectGlyphsAndState(restarted, recoveryApp.app, [glyphName], true, false);
    expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);
  },
);

test("recovers undo past the last save as a dirty document that saves explicitly", async ({
  recoveryApp,
}) => {
  const glyphName = "recoveryUndone";
  await createGlyphNamed(recoveryApp.page, glyphName);
  await expectGlyphsAndState(recoveryApp.page, recoveryApp.app, [glyphName], true, true);
  await runWindowCommand(recoveryApp.page, "file.save");
  await expectGlyphsAndState(recoveryApp.page, recoveryApp.app, [glyphName], true, false);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);

  await runWindowCommand(recoveryApp.page, "edit.undo");
  await expectGlyphsAndState(recoveryApp.page, recoveryApp.app, [glyphName], false, true);

  const recovered = await recoveryApp.crashAndRecover();
  await expectGlyphsAndState(recovered, recoveryApp.app, [glyphName], false, true);
  expect(recoveryApp.canonicalGlyphNames()).toContain(glyphName);

  await runWindowCommand(recovered, "file.save");
  await expectGlyphsAndState(recovered, recoveryApp.app, [glyphName], false, false);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(glyphName);
});

test("recovers edits made after a previous recovery", async ({ recoveryApp }) => {
  const firstGlyph = "recoveredFirst";
  const secondGlyph = "recoveredSecond";
  await createGlyphNamed(recoveryApp.page, firstGlyph);
  await expectGlyphsAndState(recoveryApp.page, recoveryApp.app, [firstGlyph], true, true);

  const recovered = await recoveryApp.crashAndRecover();
  await expectGlyphsAndState(recovered, recoveryApp.app, [firstGlyph], true, true);
  await createGlyphNamed(recovered, secondGlyph);
  await expectGlyphsAndState(recovered, recoveryApp.app, [firstGlyph, secondGlyph], true, true);

  const recoveredAgain = await recoveryApp.crashAndRecover();
  await expectGlyphsAndState(
    recoveredAgain,
    recoveryApp.app,
    [firstGlyph, secondGlyph],
    true,
    true,
  );
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(firstGlyph);
  expect(recoveryApp.canonicalGlyphNames()).not.toContain(secondGlyph);
});

test("reopens a saved document on the glyph it was editing after forced termination", async ({
  recoveryApp,
}) => {
  const editor = new EditorDriver(recoveryApp.page);
  await editor.openGlyphByUnicode("41");
  const glyph = await editor.activeGlyph();
  if (!glyph) throw new Error("Expected glyph A to be open before the crash");

  const reopened = await recoveryApp.crashAndRecoverWindow(glyph.glyphId);

  await waitForEditorReady(reopened, glyph.glyphId);
  expect(await new EditorDriver(reopened, recoveryApp.app).documentState()).toMatchObject({
    dirty: false,
  });
});

/** Waits until each of `glyphNames` is in the font, or none is, and the document is dirty or not. */
async function expectGlyphsAndState(
  page: Page,
  app: ElectronApplication,
  glyphNames: string[],
  present: boolean,
  dirty: boolean,
): Promise<void> {
  const editor = new EditorDriver(page, app);
  await expect
    .poll(
      async () => {
        const glyphs = await editor.glyphNames();
        return {
          present: glyphNames.map((name) => glyphs.includes(name)),
          document: await editor.documentState(),
        };
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ present: glyphNames.map(() => present), document: { dirty } });
}
