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

  await driverFor(recoveryApp, recoveryApp.page).setup.deleteSource(fixture.mediumSourceId);
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

  await driverFor(recoveryApp, recoveryApp.page).setup.deleteAxis(fixture.widthAxisId);
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
  const defaultSource = (await editor.defaultSource()).id;
  const axisId = await editor.setup.createAxis({
    ...WEIGHT,
    name: "Weight",
    role: "external",
    axisType: "continuous",
    labels: [],
    hidden: false,
  });
  const mediumSourceId = await editor.setup.createSource("Medium", { [axisId]: 600 });
  const boldSourceId = await editor.setup.createSource("Bold", { [axisId]: 900 });
  const instanceId = await editor.setup.createNamedInstance({
    name: "Display",
    postscriptName: "MutatorSans-Display",
    location: { [axisId]: 800 },
  });
  await editor.setup.editSource(mediumSourceId, {
    name: "Medium Master",
    italicAngle: -2,
    lineGap: 37,
    metricOffsets: { ascender: 17 },
  });

  return { axisId, defaultSourceId: defaultSource, mediumSourceId, boldSourceId, instanceId };
}

async function authorAxisTopology(recoveryApp: RecoveryApp): Promise<AxisFixture> {
  const editor = driverFor(recoveryApp, recoveryApp.page);
  const defaultSource = (await editor.defaultSource()).id;
  const weightAxisId = await editor.setup.createAxis({
    ...WEIGHT,
    name: "Weight",
    role: "external",
    axisType: "continuous",
    labels: [],
    hidden: false,
  });
  const widthAxisId = await editor.setup.createAxis({
    tag: "wdth",
    name: "Width",
    role: "external",
    axisType: "continuous",
    minimum: 50,
    default: 100,
    maximum: 200,
    labels: [],
    hidden: true,
  });
  const slantAxisId = await editor.setup.createAxis({
    tag: "slnt",
    name: "Slant",
    role: "external",
    axisType: "continuous",
    minimum: -10,
    default: 0,
    maximum: 10,
    labels: [],
    hidden: false,
  });
  const boldSourceId = await editor.setup.createSource("Bold Slanted", {
    [weightAxisId]: 900,
    [widthAxisId]: 150,
    [slantAxisId]: -8,
  });
  const instanceId = await editor.setup.createNamedInstance({
    name: "Display",
    postscriptName: "MutatorSans-Display",
    location: { [weightAxisId]: 700, [widthAxisId]: 120, [slantAxisId]: -4 },
  });

  return {
    weightAxisId,
    widthAxisId,
    slantAxisId,
    defaultSourceId: defaultSource,
    boldSourceId,
    instanceId,
  };
}

async function observeVariableFont(
  recoveryApp: RecoveryApp,
  page: Page,
): Promise<ObservedVariableFont> {
  const editor = driverFor(recoveryApp, page);
  const [{ axes, sources, instances }, defaultSource, document] = await Promise.all([
    editor.fontOverview(),
    editor.defaultSource(),
    editor.documentState(),
  ]);
  return {
    axes,
    sources,
    namedInstances: instances,
    defaultSourceId: defaultSource.id,
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
