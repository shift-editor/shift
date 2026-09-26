import { expect, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { documentTest as test, waitForWorkspaceReady } from "./fixtures/electronApp";
import {
  createAnotherDirtyFont,
  dirtyDocumentDecisions,
  dirtyDocumentRequests,
  quitApp,
  dirtyNewFont,
  requestAppQuit,
  windowTitle,
} from "./fixtures/documentLifecycle";
import { savedGlyphNames } from "./fixtures/savedDocument";

const discardOnQuitTest = test.extend({
  dirtyDocumentChoice: "discard",
});
const saveOnQuitTest = test.extend({
  dirtyDocumentChoice: "save",
});
const reentrantQuitTest = test.extend({
  dirtyDocumentChoices: ["cancel", "discard"],
  dirtyDocumentDelayMs: 150,
});

function processExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

async function saveThenDirty(page: Page, savePath: string): Promise<Buffer> {
  await page.evaluate(async (target) => {
    const coordinator = window.shift?.editCoordinator;
    if (!coordinator) throw new Error("Expected edit coordinator");

    await coordinator.save(target);
  }, savePath);
  const saved = fs.readFileSync(savePath);
  await page.getByRole("button", { name: "Create glyph", exact: true }).click();
  return saved;
}

test("canceling dirty app quit keeps the document open and dirty", async ({
  electronApp,
  page,
  saveShiftPath,
}) => {
  const workspacePage = await dirtyNewFont(page, electronApp);

  await requestAppQuit(electronApp);
  await expect.poll(() => dirtyDocumentDecisions(electronApp)).toEqual(["cancel"]);

  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  await expect.poll(() => windowTitle(workspacePage, electronApp)).toContain("Untitled *");
  expect(fs.existsSync(saveShiftPath)).toBe(false);
});

saveOnQuitTest(
  "saving dirty app quit writes before the process exits",
  async ({ electronApp, page, saveShiftPath, testRoot }) => {
    await dirtyNewFont(page, electronApp);

    await quitApp(electronApp);

    expect(savedGlyphNames(saveShiftPath, testRoot)).toContain("newGlyph");
  },
);

discardOnQuitTest(
  "discarding dirty app quit exits without writing",
  async ({ electronApp, page, saveShiftPath }) => {
    await dirtyNewFont(page, electronApp);

    await quitApp(electronApp);

    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);

saveOnQuitTest(
  "saves every dirty document before quitting",
  async ({ electronApp, page, testRoot }) => {
    const firstPage = await dirtyNewFont(page, electronApp);
    const firstPath = path.join(testRoot, "first.shift");
    await saveThenDirty(firstPage, firstPath);
    const secondPage = await createAnotherDirtyFont(firstPage, electronApp);
    const secondPath = path.join(testRoot, "second.shift");
    await saveThenDirty(secondPage, secondPath);
    expect(savedGlyphNames(firstPath, testRoot)).not.toContain("newGlyph.1");
    expect(savedGlyphNames(secondPath, testRoot)).not.toContain("newGlyph.1");

    await quitApp(electronApp);

    expect(savedGlyphNames(firstPath, testRoot)).toContain("newGlyph.1");
    expect(savedGlyphNames(secondPath, testRoot)).toContain("newGlyph.1");
  },
);

test.describe("terminal termination", () => {
  test.use({ scriptedDialogs: false });

  // Ctrl+C reaches the whole process group; service managers signal the main process.
  const terminations = [
    { signal: "SIGINT", target: "process group" },
    { signal: "SIGTERM", target: "main process" },
  ] as const;

  for (const { signal, target } of terminations) {
    test(`${signal} to the ${target} exits without saving and recovers every dirty document`, async ({
      relaunch,
      electronApp,
      page,
      testRoot,
      saveShiftPath,
    }) => {
      test.skip(process.platform === "win32", "POSIX terminal signal semantics");

      const firstPage = await dirtyNewFont(page, electronApp);
      const firstPath = path.join(testRoot, "first.shift");
      const firstSaved = await saveThenDirty(firstPage, firstPath);
      const secondPage = await createAnotherDirtyFont(firstPage, electronApp);
      const secondPath = path.join(testRoot, "second.shift");
      const secondSaved = await saveThenDirty(secondPage, secondPath);
      for (const workspacePage of [firstPage, secondPage]) {
        await workspacePage.waitForFunction(
          () =>
            window.shift?.applyStatusCell.peek() === "idle" &&
            window.shift.documentStateCell.peek()?.dirty === true,
        );
      }

      const childProcess = electronApp.process();
      const pid = childProcess.pid;
      if (pid === undefined) throw new Error("Electron process has no PID");

      // Playwright launches Electron in its own POSIX process group. Signaling
      // that group exercises Ctrl+C reaching renderers and utilities as well.
      process.kill(target === "process group" ? -pid : pid, signal);
      await expect.poll(() => processExited(childProcess), { timeout: 10_000 }).toBe(true);
      expect(fs.readFileSync(firstPath).equals(firstSaved)).toBe(true);
      expect(fs.readFileSync(secondPath).equals(secondSaved)).toBe(true);
      expect(fs.existsSync(saveShiftPath)).toBe(false);

      const restarted = await relaunch();
      await expect.poll(() => restarted.windows().length).toBe(2);
      for (const recoveredPage of restarted.windows()) {
        await waitForWorkspaceReady(recoveredPage);
        await expect
          .poll(() =>
            recoveredPage.evaluate(() => ({
              recovered: window.shift?.font
                .glyphRecords()
                .some((glyph) => glyph.name === "newGlyph.1"),
              dirty: window.shift?.documentStateCell.peek()?.dirty,
            })),
          )
          .toEqual({ recovered: true, dirty: true });
      }
    });
  }
});

test.describe("terminal termination during quit preparation", () => {
  test.use({ dirtyDocumentChoice: "save", dirtyDocumentDelayMs: 60_000 });

  test("SIGINT supersedes a pending save decision without writing or discarding", async ({
    relaunch,
    electronApp,
    page,
    saveShiftPath,
  }) => {
    test.skip(process.platform === "win32", "POSIX terminal signal semantics");

    const workspacePage = await dirtyNewFont(page, electronApp);
    await workspacePage.waitForFunction(() => window.shift?.applyStatusCell.peek() === "idle");
    await electronApp.evaluate(
      ({ app }) =>
        new Promise<void>((resolve) => {
          app.once("before-quit", () => resolve());
          app.quit();
        }),
    );

    const childProcess = electronApp.process();
    childProcess.kill("SIGINT");
    await expect.poll(() => processExited(childProcess), { timeout: 10_000 }).toBe(true);
    expect(fs.existsSync(saveShiftPath)).toBe(false);

    const restarted = await relaunch();
    const recoveredPage = await restarted.firstWindow();
    await waitForWorkspaceReady(recoveredPage);
    await expect.poll(() => windowTitle(recoveredPage, restarted)).toContain("Untitled *");
    expect(
      await recoveredPage.evaluate(() =>
        window.shift?.font.glyphRecords().some((glyph) => glyph.name === "newGlyph"),
      ),
    ).toBe(true);
  });
});

reentrantQuitTest(
  "does not start another confirmation while quit is pending",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await dirtyNewFont(page, electronApp);

    await Promise.all([requestAppQuit(electronApp), requestAppQuit(electronApp)]);
    // Both requests arrive while the first delayed confirmation is pending; a second
    // confirmation would start before the first one answers.
    await expect.poll(() => dirtyDocumentDecisions(electronApp)).toEqual(["cancel"]);
    expect(await dirtyDocumentRequests(electronApp)).toBe(1);

    await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
    expect(fs.existsSync(saveShiftPath)).toBe(false);

    await quitApp(electronApp);
    expect(fs.existsSync(saveShiftPath)).toBe(false);
  },
);
