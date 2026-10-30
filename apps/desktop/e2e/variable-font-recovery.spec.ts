import type { Axis, NamedInstance, Source, SourceId } from "@shift/types";
import { expect, recoveryTest as test, type RecoveryApp } from "./fixtures/electronApp";
import { runWindowCommand } from "./fixtures/documentLifecycle";
import { WEIGHT } from "@/testing/fonts";

interface ObservedVariableFont {
  axes: Axis[];
  sources: Source[];
  namedInstances: NamedInstance[];
  defaultSourceId: SourceId;
  dirty: boolean;
}

// Deletion cascades and undo are unit-tested in Font.test.ts; these tests prove that a
// topology edit survives forced termination, recovery, explicit Save, and reopening.
test.setTimeout(90_000);

test.describe("source topology", () => {
  test.use({
    font: {
      axes: [{ ...WEIGHT, name: "Weight" }],
      sources: { "Medium Master": { wght: 600 }, Bold: { wght: 900 } },
      // MutatorSans's Ascender is 1000; Medium Master's sits 17 units higher.
      metrics: { "Medium Master": { Ascender: 1017 } },
      instances: { Display: { wght: 800 } },
      location: { wght: WEIGHT.default },
    },
  });

  test("persists source topology", async ({ recoveryApp }) => {
    const editor = recoveryApp.editor;
    // Source edits Settings › Sources makes that the font fixture does not declare.
    await editor.setSourceItalicAngle("Medium Master", -2);
    await editor.setSourceLineGap("Medium Master", 37);
    // Recovery must keep each record's identity, so follow each by id from here on.
    const [defaultSource, medium, bold] = await Promise.all([
      editor.source("default"),
      editor.source({ name: "Medium Master" }),
      editor.source({ name: "Bold" }),
    ]);
    const fixture = {
      defaultSourceId: defaultSource!.id,
      mediumSourceId: medium!.id,
      boldSourceId: bold!.id,
    };
    await save(recoveryApp);
    const baseline = await observeVariableFont(recoveryApp);
    expect(baseline.sources.map(({ id }) => id)).toEqual([
      fixture.defaultSourceId,
      fixture.mediumSourceId,
      fixture.boldSourceId,
    ]);
    expectCanonicalFont(recoveryApp, baseline);

    await editor.deleteSource("Medium Master");
    const deleted = await observeVariableFont(recoveryApp);
    expect(deleted).toMatchObject({
      defaultSourceId: fixture.defaultSourceId,
      dirty: true,
    });
    expect(deleted.sources.map(({ id }) => id)).toEqual([
      fixture.defaultSourceId,
      fixture.boldSourceId,
    ]);
    expectCanonicalFont(recoveryApp, baseline);

    await recoveryApp.crashAndRecover();
    await expectVariableFont(recoveryApp, deleted);
    expectCanonicalFont(recoveryApp, baseline);

    await save(recoveryApp);
    const saved = { ...deleted, dirty: false };
    await expectVariableFont(recoveryApp, saved);
    expectCanonicalFont(recoveryApp, saved);

    await recoveryApp.crashAndReopenDocument();
    await expectVariableFont(recoveryApp, saved);
  });
});

test.describe("axis topology", () => {
  test.use({
    font: {
      axes: [
        { ...WEIGHT, name: "Weight" },
        { tag: "wdth", name: "Width", minimum: 50, default: 100, maximum: 200 },
        { tag: "slnt", name: "Slant", minimum: -10, default: 0, maximum: 10 },
      ],
      sources: { "Bold Slanted": { wght: 900, wdth: 150, slnt: -8 } },
      instances: { Display: { wght: 700, wdth: 120, slnt: -4 } },
      location: { wght: WEIGHT.default, wdth: 100, slnt: 0 },
    },
  });

  test("persists axis topology", async ({ recoveryApp }) => {
    const editor = recoveryApp.editor;
    // Recovery must keep each record's identity, so follow each by id from here on.
    const [weight, width, slant, defaultSource] = await Promise.all([
      editor.axis({ tag: "wght" }),
      editor.axis({ tag: "wdth" }),
      editor.axis({ tag: "slnt" }),
      editor.source("default"),
    ]);
    const fixture = {
      weightAxisId: weight!.id,
      widthAxisId: width!.id,
      slantAxisId: slant!.id,
      defaultSourceId: defaultSource!.id,
    };
    await save(recoveryApp);
    const baseline = await observeVariableFont(recoveryApp);
    expect(baseline.axes.map(({ id }) => id)).toEqual([
      fixture.weightAxisId,
      fixture.widthAxisId,
      fixture.slantAxisId,
    ]);
    expectCanonicalFont(recoveryApp, baseline);

    await editor.deleteAxis("wdth");
    const deleted = await observeVariableFont(recoveryApp);
    expect(deleted.axes.map(({ id }) => id)).toEqual([fixture.weightAxisId, fixture.slantAxisId]);
    expect(deleted.defaultSourceId).toBe(fixture.defaultSourceId);
    expect(deleted.dirty).toBe(true);
    expectCanonicalFont(recoveryApp, baseline);

    await recoveryApp.crashAndRecover();
    await expectVariableFont(recoveryApp, deleted);
    expectCanonicalFont(recoveryApp, baseline);

    await save(recoveryApp);
    const saved = { ...deleted, dirty: false };
    await expectVariableFont(recoveryApp, saved);
    expectCanonicalFont(recoveryApp, saved);

    await recoveryApp.crashAndReopenDocument();
    await expectVariableFont(recoveryApp, saved);
  });
});

async function observeVariableFont(recoveryApp: RecoveryApp): Promise<ObservedVariableFont> {
  const editor = recoveryApp.editor;
  const [{ axes, sources, instances }, defaultSource, document] = await Promise.all([
    editor.fontOverview(),
    editor.source("default"),
    editor.documentState(),
  ]);
  return {
    axes,
    sources,
    namedInstances: instances,
    defaultSourceId: defaultSource!.id,
    dirty: document?.dirty ?? false,
  };
}

async function expectVariableFont(
  recoveryApp: RecoveryApp,
  expected: ObservedVariableFont,
): Promise<void> {
  await expect.poll(() => observeVariableFont(recoveryApp), { timeout: 20_000 }).toEqual(expected);
}

function expectCanonicalFont(recoveryApp: RecoveryApp, expected: ObservedVariableFont): void {
  expect(recoveryApp.canonicalVariableFont()).toEqual({
    axes: expected.axes,
    sources: expected.sources,
    namedInstances: expected.namedInstances,
  });
}

/** Saves through File › Save, as its menu item does, and waits until the document is clean. */
async function save(recoveryApp: RecoveryApp): Promise<void> {
  const editor = recoveryApp.editor;
  await runWindowCommand(editor.page, "file.save");
  await expect
    .poll(() => editor.documentState(), { timeout: 20_000 })
    .toMatchObject({ dirty: false });
}
