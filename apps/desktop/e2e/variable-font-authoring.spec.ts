import type { Locator, Page } from "@playwright/test";
import { expect, workspaceTest as test } from "./fixtures/electronApp";

async function openSettings(page: Page, category: "Axes" | "Sources" | "Instances") {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: category, exact: true }).click();
  return dialog;
}

async function selectCategory(dialog: Locator, category: "Axes" | "Sources" | "Instances") {
  await dialog.getByRole("button", { name: category, exact: true }).click();
}

test.describe("variable-font authoring controls", () => {
  test("creates an axis, source, and named instance through Settings", async ({ page, editor }) => {
    await expect.poll(async () => (await editor.fontOverview()).axes.length).toBe(0);
    const dialog = await openSettings(page, "Axes");

    await dialog.getByLabel("Create axis").click();
    await page.getByRole("menuitem").filter({ hasText: "Weight" }).click();
    await expect.poll(() => editor.fontOverview()).toMatchObject({ axes: [{ tag: "wght" }] });

    const axisName = dialog.locator("main").getByLabel("Name", { exact: true });
    await axisName.fill("Weight Class");
    await axisName.press("Tab");
    const axisId = (await editor.fontOverview()).axes[0]?.id;
    if (!axisId) throw new Error("Expected created axis");
    await expect.poll(() => editor.axis({ id: axisId })).toMatchObject({ name: "Weight Class" });

    await selectCategory(dialog, "Sources");
    const defaultSourceName = (await editor.fontOverview()).sources[0]?.name;
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

    const axis = await editor.axis({ id: axisId });
    const authored = {
      axis: axis && {
        tag: axis.tag,
        name: axis.name,
        minimum: axis.minimum,
        default: axis.default,
        maximum: axis.maximum,
      },
      source: (await editor.source({ name: "Bold" }))?.location.values[axisId],
      instance: (await editor.instance({ name: "Black" }))?.location.values[axisId],
      dirty: (await editor.documentState())?.dirty,
    };
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

  test.describe("with an opsz axis, a Bold source and a Black instance", () => {
    test.use({
      font: {
        axes: [{ tag: "opsz", name: "Optical Size", minimum: 100, default: 400, maximum: 900 }],
        sources: { Bold: { opsz: 900 } },
        instances: { Black: { opsz: 800 } },
        location: { opsz: 400 },
      },
    });

    test("edits and removes variable records through Settings", async ({ page, editor }) => {
      // The edits rename and move these records, so follow each by id from here on.
      const [axis, source, instance] = await Promise.all([
        editor.axis({ tag: "opsz" }),
        editor.source({ name: "Bold" }),
        editor.instance({ name: "Black" }),
      ]);
      const fixture = { axisId: axis!.id, sourceId: source!.id, instanceId: instance!.id };
      const dialog = await openSettings(page, "Axes");
      const main = dialog.locator("main");

      const axisName = main.getByLabel("Name", { exact: true });
      await axisName.fill("Optical Scale");
      await axisName.press("Tab");
      await expect
        .poll(async () => (await editor.axis({ id: fixture.axisId }))?.name)
        .toBe("Optical Scale");

      await selectCategory(dialog, "Sources");
      const defaultSource = (await editor.source("default"))!.name;
      await expect(dialog.getByLabel(`Delete ${defaultSource}`)).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await dialog.getByRole("button", { name: "Bold", exact: true }).click();
      const sourceName = main.getByLabel("Name", { exact: true });
      await sourceName.fill("Display Bold");
      await sourceName.press("Tab");
      const sourceLocation = main.getByLabel("Optical Scale", { exact: true });
      await sourceLocation.fill("850");
      await sourceLocation.press("Tab");
      await expect
        .poll(
          async () =>
            (await editor.source({ name: "Display Bold" }))?.location.values[fixture.axisId],
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
        .poll(
          async () =>
            (await editor.instance({ id: fixture.instanceId }))?.location.values[fixture.axisId],
        )
        .toBe(750);

      await dialog.getByLabel("Delete Display Black").click();
      await expect.poll(() => editor.instance({ id: fixture.instanceId })).toBeNull();
      await selectCategory(dialog, "Sources");
      await dialog.getByLabel("Delete Display Bold").click();
      await expect.poll(() => editor.source({ id: fixture.sourceId })).toBeNull();

      await selectCategory(dialog, "Axes");
      await dialog.getByLabel("Delete Optical Scale").click();
      await expect.poll(() => editor.axis({ id: fixture.axisId })).toBeNull();
    });
  });
});
