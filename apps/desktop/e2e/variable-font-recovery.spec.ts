import type { Page } from "@playwright/test";
import type { Axis, AxisId, NamedInstance, NamedInstanceId, Source, SourceId } from "@shift/types";
import { expect, recoveryTest as test, type RecoveryApp } from "./fixtures/electronApp";
import { runWindowCommand } from "./fixtures/documentLifecycle";
import { EditorDriver } from "./fixtures/EditorDriver";
import { WEIGHT } from "@/testing/fonts";

interface ObservedVariableFont {
  axes: Axis[];
  sources: Source[];
  namedInstances: NamedInstance[];
  defaultSourceId: SourceId;
  dirty: boolean;
}

interface SourceFixture {
  axisId: AxisId;
  defaultSourceId: SourceId;
  mediumSourceId: SourceId;
  boldSourceId: SourceId;
  instanceId: NamedInstanceId;
}

interface AxisFixture {
  weightAxisId: AxisId;
  widthAxisId: AxisId;
  slantAxisId: AxisId;
  defaultSourceId: SourceId;
  boldSourceId: SourceId;
  instanceId: NamedInstanceId;
}

// Deletion cascades and undo are unit-tested in Font.test.ts; these tests prove that a
// topology edit survives forced termination, recovery, explicit Save, and reopening.
test.setTimeout(90_000);

test("persists source topology", async ({ recoveryApp }) => {
  const fixture = await authorSourceTopology(recoveryApp);
  await save(recoveryApp, recoveryApp.page);
  const baseline = await observeVariableFont(recoveryApp, recoveryApp.page);
  expect(baseline.sources.map(({ id }) => id)).toEqual([
    fixture.defaultSourceId,
    fixture.mediumSourceId,
    fixture.boldSourceId,
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  await driverFor(recoveryApp, recoveryApp.page).deleteSource("Medium Master");
  const deleted = await observeVariableFont(recoveryApp, recoveryApp.page);
  expect(deleted).toMatchObject({
    defaultSourceId: fixture.defaultSourceId,
    dirty: true,
  });
  expect(deleted.sources.map(({ id }) => id)).toEqual([
    fixture.defaultSourceId,
    fixture.boldSourceId,
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  const recovered = await recoveryApp.crashAndRecover();
  await expectVariableFont(recoveryApp, recovered, deleted);
  expectCanonicalFont(recoveryApp, baseline);

  await save(recoveryApp, recovered);
  const saved = { ...deleted, dirty: false };
  await expectVariableFont(recoveryApp, recovered, saved);
  expectCanonicalFont(recoveryApp, saved);

  const reopened = await recoveryApp.crashAndReopenDocument();
  await expectVariableFont(recoveryApp, reopened, saved);
});

test("persists axis topology", async ({ recoveryApp }) => {
  const fixture = await authorAxisTopology(recoveryApp);
  await save(recoveryApp, recoveryApp.page);
  const baseline = await observeVariableFont(recoveryApp, recoveryApp.page);
  expect(baseline.axes.map(({ id }) => id)).toEqual([
    fixture.weightAxisId,
    fixture.widthAxisId,
    fixture.slantAxisId,
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  await driverFor(recoveryApp, recoveryApp.page).deleteAxis("wdth");
  const deleted = await observeVariableFont(recoveryApp, recoveryApp.page);
  expect(deleted.axes.map(({ id }) => id)).toEqual([fixture.weightAxisId, fixture.slantAxisId]);
  expect(deleted.defaultSourceId).toBe(fixture.defaultSourceId);
  expect(deleted.dirty).toBe(true);
  expectCanonicalFont(recoveryApp, baseline);

  const recovered = await recoveryApp.crashAndRecover();
  await expectVariableFont(recoveryApp, recovered, deleted);
  expectCanonicalFont(recoveryApp, baseline);

  await save(recoveryApp, recovered);
  const saved = { ...deleted, dirty: false };
  await expectVariableFont(recoveryApp, recovered, saved);
  expectCanonicalFont(recoveryApp, saved);

  const reopened = await recoveryApp.crashAndReopenDocument();
  await expectVariableFont(recoveryApp, reopened, saved);
});

/** A driver for `page` in the app the recovery fixture is running now. */
function driverFor(recoveryApp: RecoveryApp, page: Page): EditorDriver {
  return new EditorDriver(page, recoveryApp.app);
}

async function authorSourceTopology(recoveryApp: RecoveryApp): Promise<SourceFixture> {
  const editor = driverFor(recoveryApp, recoveryApp.page);
  await editor.addAxis({ ...WEIGHT, name: "Weight" });
  await editor.addSource("Medium", { wght: 600 });
  const { metrics } = await editor.location();
  await editor.addSource("Bold", { wght: 900 });
  await editor.addInstance("Display", { wght: 800 });
  await editor.renameSource("Medium", "Medium Master");
  await editor.setSourceItalicAngle("Medium Master", -2);
  await editor.setSourceLineGap("Medium Master", 37);
  await editor.setSourceMetric("Medium Master", "Ascender", metrics.ascender + 17);
  await editor.setLocation({ wght: WEIGHT.default });

  const [axis, defaultSource, medium, bold, instance] = await Promise.all([
    editor.axis({ tag: "wght" }),
    editor.source("default"),
    editor.source({ name: "Medium Master" }),
    editor.source({ name: "Bold" }),
    editor.instance({ name: "Display" }),
  ]);
  return {
    axisId: axis!.id,
    defaultSourceId: defaultSource!.id,
    mediumSourceId: medium!.id,
    boldSourceId: bold!.id,
    instanceId: instance!.id,
  };
}

async function authorAxisTopology(recoveryApp: RecoveryApp): Promise<AxisFixture> {
  const editor = driverFor(recoveryApp, recoveryApp.page);
  await editor.addAxis({ ...WEIGHT, name: "Weight" });
  await editor.addAxis({ tag: "wdth", name: "Width", minimum: 50, default: 100, maximum: 200 });
  await editor.addAxis({ tag: "slnt", name: "Slant", minimum: -10, default: 0, maximum: 10 });
  await editor.addSource("Bold Slanted", { wght: 900, wdth: 150, slnt: -8 });
  await editor.addInstance("Display", { wght: 700, wdth: 120, slnt: -4 });
  await editor.setLocation({ wght: WEIGHT.default, wdth: 100, slnt: 0 });

  const [weight, width, slant, defaultSource, bold, instance] = await Promise.all([
    editor.axis({ tag: "wght" }),
    editor.axis({ tag: "wdth" }),
    editor.axis({ tag: "slnt" }),
    editor.source("default"),
    editor.source({ name: "Bold Slanted" }),
    editor.instance({ name: "Display" }),
  ]);
  return {
    weightAxisId: weight!.id,
    widthAxisId: width!.id,
    slantAxisId: slant!.id,
    defaultSourceId: defaultSource!.id,
    boldSourceId: bold!.id,
    instanceId: instance!.id,
  };
}

async function observeVariableFont(
  recoveryApp: RecoveryApp,
  page: Page,
): Promise<ObservedVariableFont> {
  const editor = driverFor(recoveryApp, page);
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
  page: Page,
  expected: ObservedVariableFont,
): Promise<void> {
  await expect
    .poll(() => observeVariableFont(recoveryApp, page), { timeout: 20_000 })
    .toEqual(expected);
}

function expectCanonicalFont(recoveryApp: RecoveryApp, expected: ObservedVariableFont): void {
  expect(recoveryApp.canonicalVariableFont()).toEqual({
    axes: expected.axes,
    sources: expected.sources,
    namedInstances: expected.namedInstances,
  });
}

/** Saves through File › Save, as its menu item does, and waits until the document is clean. */
async function save(recoveryApp: RecoveryApp, page: Page): Promise<void> {
  await runWindowCommand(page, "file.save");
  const editor = driverFor(recoveryApp, page);
  await expect
    .poll(async () => (await editor.documentState())?.dirty, { timeout: 20_000 })
    .toBe(false);
}
