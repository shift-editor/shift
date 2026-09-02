import type { Locator, Page } from "@playwright/test";
import type { AxisId, NamedInstanceId, SourceId } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";

interface VariableFixture {
  axisId: AxisId;
  sourceId: SourceId;
  instanceId: NamedInstanceId;
}

async function openSettings(page: Page, category: "Axes" | "Sources" | "Instances") {
  await page.getByLabel(/Display and edit font information/).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: category, exact: true }).click();
  return dialog;
}

async function selectCategory(dialog: Locator, category: "Axes" | "Sources" | "Instances") {
  await dialog.getByRole("button", { name: category, exact: true }).click();
}

async function createVariableFixture(page: Page): Promise<VariableFixture> {
  return page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected authored font");

    const axisId = font.createAxis({
      tag: "opsz",
      name: "Optical Size",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
    const sourceId = font.createSource("Bold", new Map([[axisId, 900]]));
    const instanceId = font.createNamedInstance({
      name: "Black",
      location: { values: { [axisId]: 800 } },
    });
    await font.editCoordinator.settled();
    return { axisId, sourceId, instanceId };
  });
}

test.describe("variable-font authoring controls", () => {
  test("creates an axis, source, and named instance through Settings", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => window.shift?.font.getAxes().length)).toBe(0);
    const dialog = await openSettings(page, "Axes");

    await dialog.getByLabel("Create axis").click();
    await page.getByRole("menuitem").filter({ hasText: "Weight" }).click();
    await expect.poll(() => page.evaluate(() => window.shift?.font.getAxes()[0]?.tag)).toBe("wght");

    const axisName = dialog.locator("main").getByLabel("Name", { exact: true });
    await axisName.fill("Weight Class");
    await axisName.press("Tab");
    const axisId = await page.evaluate(() => window.shift?.font.getAxes()[0]?.id);
    if (!axisId) throw new Error("Expected created axis");
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.shift?.font.getAxes().find((axis) => axis.id === id)?.name,
          axisId,
        ),
      )
      .toBe("Weight Class");

    await selectCategory(dialog, "Sources");
    const defaultSourceName = await page.evaluate(() => window.shift?.font.sources[0]?.name);
    await dialog.getByLabel("Create source").click();
    await page.locator("#create-source-name").fill("Bold");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      `${defaultSourceName} already exists at this location`,
    );
    await page
      .getByRole("group", { name: "Source location" })
      .getByLabel("Weight Class")
      .fill("900");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Bold", exact: true })).toBeVisible();

    await selectCategory(dialog, "Instances");
    await dialog.getByLabel("Create instance").click();
    await page.locator("#create-instance-name").fill("Black");
    await page
      .getByRole("group", { name: "Instance location" })
      .getByLabel("Weight Class")
      .fill("800");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Black", exact: true })).toBeVisible();

    const authored = await page.evaluate(async (id) => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected authored font");
      const axis = font.getAxes().find(({ id: candidateId }) => candidateId === id);
      return {
        axis: axis && {
          tag: axis.tag,
          name: axis.name,
          minimum: axis.minimum,
          default: axis.default,
          maximum: axis.maximum,
        },
        source: font.sources.find(({ name }) => name === "Bold")?.location.values[id],
        instance: font.namedInstances.find(({ name }) => name === "Black")?.location.values[id],
        dirty: (await font.editCoordinator.state())?.dirty,
      };
    }, axisId);
    expect(authored).toEqual({
      axis: {
        tag: "wght",
        name: "Weight Class",
        minimum: 100,
        default: 400,
        maximum: 900,
      },
      source: 900,
      instance: 800,
      dirty: true,
    });
  });

  test("edits and removes variable records through Settings", async ({ page }) => {
    const fixture = await createVariableFixture(page);
    const dialog = await openSettings(page, "Axes");
    const main = dialog.locator("main");

    const axisName = main.getByLabel("Name", { exact: true });
    await axisName.fill("Optical Scale");
    await axisName.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.shift?.font.getAxes().find((axis) => axis.id === id)?.name,
          fixture.axisId,
        ),
      )
      .toBe("Optical Scale");

    await selectCategory(dialog, "Sources");
    const defaultSourceName = await page.evaluate(() => window.shift?.font.defaultSource.name);
    if (!defaultSourceName) throw new Error("Expected default source");
    await expect(
      dialog.getByLabel(`Cannot delete ${defaultSourceName}: default source`),
    ).toHaveAttribute("aria-disabled", "true");
    await dialog.getByRole("button", { name: "Bold", exact: true }).click();
    const sourceName = main.getByLabel("Name", { exact: true });
    await sourceName.fill("Display Bold");
    await sourceName.press("Tab");
    const sourceLocation = main.getByLabel("Optical Scale", { exact: true });
    await sourceLocation.fill("850");
    await sourceLocation.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          ({ sourceId, axisId }) => window.shift?.font.source(sourceId)?.location.values[axisId],
          fixture,
        ),
      )
      .toBe(850);

    await selectCategory(dialog, "Instances");
    await dialog.getByRole("button", { name: "Black", exact: true }).click();
    const instanceName = main.getByLabel("Name", { exact: true });
    await instanceName.fill("Display Black");
    await instanceName.press("Tab");
    const instanceLocation = main.getByLabel("Optical Scale", { exact: true });
    await instanceLocation.fill("750");
    await instanceLocation.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          ({ instanceId, axisId }) =>
            window.shift?.font.namedInstances.find(({ id }) => id === instanceId)?.location.values[
              axisId
            ],
          fixture,
        ),
      )
      .toBe(750);

    await dialog.getByLabel("Delete Display Black").click();
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.shift?.font.namedInstances.some((instance) => instance.id === id),
          fixture.instanceId,
        ),
      )
      .toBe(false);
    await selectCategory(dialog, "Sources");
    await dialog.getByLabel("Delete Display Bold").click();
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.shift?.font.sources.some((source) => source.id === id),
          fixture.sourceId,
        ),
      )
      .toBe(false);

    await selectCategory(dialog, "Axes");
    await dialog.getByLabel("Delete Optical Scale").click();
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.shift?.font.getAxes().some((axis) => axis.id === id),
          fixture.axisId,
        ),
      )
      .toBe(false);
  });
});
