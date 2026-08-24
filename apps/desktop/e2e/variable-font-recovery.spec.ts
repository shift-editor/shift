import type { Page } from "@playwright/test";
import type { Axis, AxisId, NamedInstance, NamedInstanceId, Source, SourceId } from "@shift/types";
import { expect, recoveryTest as test, type RecoveryApp } from "./fixtures/electronApp";

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

test.setTimeout(90_000);

test("persists source topology", async ({ recoveryApp }) => {
  const fixture = await authorSourceTopology(recoveryApp.page);
  await save(recoveryApp.page);
  const baseline = await observeVariableFont(recoveryApp.page);
  expect(baseline.sources.map(({ id }) => id)).toEqual([
    fixture.defaultSourceId,
    fixture.mediumSourceId,
    fixture.boldSourceId,
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  await recoveryApp.page.evaluate(async (sourceId) => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    font.deleteSource(sourceId);
    await font.editCoordinator.settled();
  }, fixture.mediumSourceId);
  const deleted = await observeVariableFont(recoveryApp.page);
  expect(deleted).toMatchObject({
    defaultSourceId: fixture.defaultSourceId,
    dirty: true,
  });
  expect(deleted.sources.map(({ id }) => id)).toEqual([
    fixture.defaultSourceId,
    fixture.boldSourceId,
  ]);
  expect(deleted.axes).toEqual(baseline.axes);
  expect(deleted.namedInstances).toEqual(baseline.namedInstances);
  expectCanonicalFont(recoveryApp, baseline);

  await undo(recoveryApp.page);
  await expectVariableFont(recoveryApp.page, { ...baseline, dirty: false });
  await redo(recoveryApp.page);
  await expectVariableFont(recoveryApp.page, deleted);

  const recovered = await recoveryApp.crashAndRestart();
  await expectVariableFont(recovered, deleted);
  expectCanonicalFont(recoveryApp, baseline);

  await save(recovered);
  const saved = { ...deleted, dirty: false };
  await expectVariableFont(recovered, saved);
  expectCanonicalFont(recoveryApp, saved);

  const reopened = await recoveryApp.crashAndRestart();
  await expectVariableFont(reopened, saved);
});

test("persists axis topology", async ({ recoveryApp }) => {
  const fixture = await authorAxisTopology(recoveryApp.page);
  await save(recoveryApp.page);
  const baseline = await observeVariableFont(recoveryApp.page);
  expect(baseline.axes.map(({ id }) => id)).toEqual([
    fixture.weightAxisId,
    fixture.widthAxisId,
    fixture.slantAxisId,
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  await recoveryApp.page.evaluate(async (axisId) => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    font.deleteAxis(axisId);
    await font.editCoordinator.settled();
  }, fixture.widthAxisId);
  const deleted = await observeVariableFont(recoveryApp.page);
  expect(deleted.axes.map(({ id }) => id)).toEqual([fixture.weightAxisId, fixture.slantAxisId]);
  expect(deleted.defaultSourceId).toBe(fixture.defaultSourceId);
  expect(deleted.dirty).toBe(true);
  expect(deleted.sources.every(({ location }) => !(fixture.widthAxisId in location.values))).toBe(
    true,
  );
  expect(deleted.sources.find(({ id }) => id === fixture.boldSourceId)?.location.values).toEqual({
    [fixture.weightAxisId]: 900,
    [fixture.slantAxisId]: -8,
  });
  expect(deleted.namedInstances).toEqual([
    {
      id: fixture.instanceId,
      name: "Display",
      postscriptName: "MutatorSans-Display",
      location: {
        values: {
          [fixture.weightAxisId]: 700,
          [fixture.slantAxisId]: -4,
        },
      },
    },
  ]);
  expectCanonicalFont(recoveryApp, baseline);

  await undo(recoveryApp.page);
  await expectVariableFont(recoveryApp.page, { ...baseline, dirty: false });
  await redo(recoveryApp.page);
  await expectVariableFont(recoveryApp.page, deleted);

  const recovered = await recoveryApp.crashAndRestart();
  await expectVariableFont(recovered, deleted);
  expectCanonicalFont(recoveryApp, baseline);

  await save(recovered);
  const saved = { ...deleted, dirty: false };
  await expectVariableFont(recovered, saved);
  expectCanonicalFont(recoveryApp, saved);

  const reopened = await recoveryApp.crashAndRestart();
  await expectVariableFont(reopened, saved);
});

async function authorSourceTopology(page: Page): Promise<SourceFixture> {
  return page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    const defaultSourceId = font.defaultSource.id;
    const axisId = font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();

    const mediumSourceId = font.createSource("Medium", new Map([[axisId, 600]]));
    const boldSourceId = font.createSource("Bold", new Map([[axisId, 900]]));
    const instanceId = font.createNamedInstance({
      name: "Display",
      postscriptName: "MutatorSans-Display",
      location: { values: { [axisId]: 800 } },
    });
    await font.editCoordinator.settled();

    const medium = font.source(mediumSourceId);
    if (!medium) throw new Error("Expected Medium source");
    await font.updateSource({
      ...medium,
      name: "Medium Master",
      italicAngle: -2,
      lineGap: 37,
      metricValues: medium.metricValues.map((value, index) =>
        index === 0 ? { ...value, position: value.position + 17 } : value,
      ),
    });

    return { axisId, defaultSourceId, mediumSourceId, boldSourceId, instanceId };
  });
}

async function authorAxisTopology(page: Page): Promise<AxisFixture> {
  return page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    const defaultSourceId = font.defaultSource.id;
    const weightAxisId = font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
    const widthAxisId = font.createAxis({
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
    await font.editCoordinator.settled();
    const slantAxisId = font.createAxis({
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
    await font.editCoordinator.settled();

    const boldSourceId = font.createSource(
      "Bold Slanted",
      new Map([
        [weightAxisId, 900],
        [widthAxisId, 150],
        [slantAxisId, -8],
      ]),
    );
    const instanceId = font.createNamedInstance({
      name: "Display",
      postscriptName: "MutatorSans-Display",
      location: {
        values: {
          [weightAxisId]: 700,
          [widthAxisId]: 120,
          [slantAxisId]: -4,
        },
      },
    });
    await font.editCoordinator.settled();

    return {
      weightAxisId,
      widthAxisId,
      slantAxisId,
      defaultSourceId,
      boldSourceId,
      instanceId,
    };
  });
}

async function observeVariableFont(page: Page): Promise<ObservedVariableFont> {
  return page.evaluate(() => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected authored workspace");

    return {
      axes: workspace.font.getAxes(),
      sources: workspace.font.sources,
      namedInstances: workspace.font.namedInstances,
      defaultSourceId: workspace.font.defaultSource.id,
      dirty: workspace.documentStateCell.peek()?.dirty ?? false,
    };
  });
}

async function expectVariableFont(page: Page, expected: ObservedVariableFont): Promise<void> {
  await expect.poll(() => observeVariableFont(page), { timeout: 20_000 }).toEqual(expected);
}

function expectCanonicalFont(recoveryApp: RecoveryApp, expected: ObservedVariableFont): void {
  expect(recoveryApp.canonicalVariableFont()).toEqual({
    axes: expected.axes,
    sources: expected.sources,
    namedInstances: expected.namedInstances,
  });
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.shift?.font.editCoordinator.undo();
  });
}

async function redo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.shift?.font.editCoordinator.redo();
  });
}

async function save(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.shiftHost?.commands.run("file.save");
  });
  await expect
    .poll(() => page.evaluate(() => window.shift?.documentStateCell.peek()?.dirty), {
      timeout: 20_000,
    })
    .toBe(false);
}
