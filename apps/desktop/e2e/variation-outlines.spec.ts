import type { Page } from "@playwright/test";
import type { PointId } from "@shift/types";
import { resolve } from "node:path";
import {
  workspaceTest,
  expect,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";
import { editorSidebar, openVariationControls, variationControls } from "./fixtures/appLocators";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  editingLayerMatchCount,
  instanceBetweenSources,
  matchedEditingPoint,
} from "./fixtures/editorInteractions";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

const test = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });

const toggleModifier = process.platform === "darwin" ? "Meta" : "Control";

workspaceTest.describe("mapped weight interpolation", () => {
  workspaceTest.use({
    startupFontPath: resolve(process.cwd(), "../../fixtures/fonts/MappedWeight.glyphs"),
  });

  workspaceTest(
    "named instances display mapped user weights between masters",
    async ({ page, editor }) => {
      await editor.openGlyphByName("A");
      const controls = await openVariationControls(page);
      const { instances } = await editor.fontOverview();

      for (const [name, x, advance] of [
        ["ExtraLight", 50, 407.14285714285717],
        ["SemiBold", 110, 697.2972972972973],
      ] as const) {
        const instance = instances.find((candidate) => candidate.name === name);
        if (!instance) throw new Error(`Expected ${name} instance`);
        await controls.getByTestId(`instance-${instance.id}`).click();
        await editor.waitForCanvasRender();
        await expect
          .poll(() =>
            // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits on the open-glyph refactor: reads the interpolated outline
            page.evaluate(() => {
              const editor = window.shiftSession!.editor;
              const node = editor.scene.first("glyph")!;
              const model = editor
                .glyphForId(node.glyphId)!
                .renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
              return {
                x: Math.max(...model.allPoints.map((point) => point.x)),
                advance: model.xAdvance,
              };
            }),
          )
          .toEqual({ x: expect.closeTo(x, 8), advance: expect.closeTo(advance, 8) });
      }
    },
  );
});

interface OutlineFixture {
  readonly activeSource: { readonly id: string; readonly name: string };
  readonly source: { readonly id: string; readonly name: string };
  readonly comparisonSourceIds: readonly string[];
  readonly instance: { readonly id: string; readonly name: string };
  readonly instanceIds: readonly string[];
}

/** Opens S with the Variations tab and returns the sources and instances it can outline. */
async function openOutlineFixture(page: Page, editor: EditorDriver): Promise<OutlineFixture> {
  await navigateToEditor(page, "53");
  await openVariationControls(page);

  const [{ sources, instances }, { activeSourceId }] = await Promise.all([
    editor.fontOverview(),
    editor.editorView(),
  ]);
  const activeSource = sources.find(({ id }) => id === activeSourceId);
  const comparisonSources = sources.filter(({ id }) => id !== activeSourceId);
  const instance = instances[0];
  if (!activeSource || !comparisonSources[0] || !instance) {
    throw new Error("Expected variable sources and an instance");
  }

  return {
    activeSource: { id: activeSource.id, name: activeSource.name },
    source: { id: comparisonSources[0].id, name: comparisonSources[0].name },
    comparisonSourceIds: comparisonSources.map(({ id }) => `source:${id}`).sort(),
    instance: { id: instance.id, name: instance.name },
    instanceIds: instances.map(({ id }) => `instance:${id}`).sort(),
  };
}

/** Returns the comparison outlines the glyph node draws, as sorted `kind:id` keys. */
async function drawnOutlines(editor: EditorDriver): Promise<readonly string[]> {
  return (await editor.drawnOutlineTargets())
    .map((target) =>
      target.kind === "source" ? `source:${target.sourceId}` : `instance:${target.instanceId}`,
    )
    .sort();
}

function outlineToggle(
  page: Page,
  action: "Show" | "Hide",
  kind: "source" | "instance",
  name: string,
) {
  return variationControls(page).getByRole("button", {
    name: `${action} outline for ${name} ${kind}`,
    exact: true,
  });
}

async function activeSourceId(editor: EditorDriver): Promise<string | null> {
  return (await editor.editorView()).activeSourceId;
}

/** Where the point `pointId` sits in the open glyph's layer at the source named `source`. */
async function pointInSource(
  editor: EditorDriver,
  source: string,
  pointId: PointId,
): Promise<{ x: number; y: number } | null> {
  const glyph = (await editor.editorView()).glyph;
  if (!glyph) throw new Error("Expected an open glyph");
  const point = (await editor.layerOf(glyph.name, source)).contours
    .flatMap((contour) => contour.points)
    .find((candidate) => candidate.id === pointId);
  return point ? { x: point.x, y: point.y } : null;
}

test("moves matched points in every selected source as one edit", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const [{ sources }, { activeSourceId: active }] = await Promise.all([
    editor.fontOverview(),
    editor.editorView(),
  ]);
  const source = sources.find(({ id }) => id !== active);
  if (!source) throw new Error("Expected comparison source");

  await controls
    .getByTestId(`source-${source.id}`)
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect.poll(() => editingLayerMatchCount(page)).toBe(1);

  const drag = await editor.selectVisiblePoint();
  const referenceBefore = (await editor.point(drag.id))!;
  const target = await matchedEditingPoint(page, drag.id);

  await editor.dragPoint(drag);
  const referenceAfter = (await editor.point(drag.id))!;
  const targetAfter = await pointInSource(editor, source.name, target.pointId);
  expect(targetAfter).toEqual({
    x: target.position.x + referenceAfter.x - referenceBefore.x,
    y: target.position.y + referenceAfter.y - referenceBefore.y,
  });

  await editor.undo();
  await expect.poll(() => editor.point(drag.id)).toEqual(referenceBefore);
  await expect
    .poll(() => pointInSource(editor, source.name, target.pointId))
    .toEqual(target.position);
});

test("selects displayed objects at an interpolated instance", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const instanceId = await instanceBetweenSources(page);
  if (!instanceId) throw new Error("Expected an interpolated instance");

  await controls.getByTestId(`instance-${instanceId}`).click();
  await expect.poll(() => activeSourceId(editor)).toBeNull();
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits on the open-glyph refactor: reads the interpolated outline
  const pointId = await page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.first("glyph");
    const point = node
      ? editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation).allPoints[0]
      : null;
    if (!point) throw new Error("Expected an interpolated point");

    return point.id;
  });

  const sidebar = editorSidebar(page);
  await sidebar.getByRole("tab", { name: "Objects", exact: true }).click();
  await sidebar.getByTestId(`object-${pointId}`).click();
  await expect.poll(() => editor.selectionIds()).toEqual([pointId]);
});

test("row visibility outlines one comparison source without changing the active source", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const controls = variationControls(page);
  const sourceKey = `source:${fixture.source.id}`;
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
  await expect(outlineToggle(page, "Show", "source", fixture.activeSource.name)).toHaveCount(0);

  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);
  await expect(controls.getByTestId(`source-${fixture.source.id}`)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await activeSourceId(editor)).toBe(fixture.activeSource.id);

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
});

test("editing-selection sources stay outlined until hidden, panning, or deselected", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const sourceKey = `source:${fixture.source.id}`;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  expect(await activeSourceId(editor)).toBe(fixture.activeSource.id);
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);

  // Leaving and rejoining the editing selection forgets the per-row hide.
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);

  // Holding Space over the canvas pans with the hand tool, which hides comparison outlines.
  await editor.canvas.hover();
  await page.keyboard.down("Space");
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
  await page.keyboard.up("Space");
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
});

test("an explicitly shown source outline survives leaving the editing selection", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const sourceKey = `source:${fixture.source.id}`;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);
});

test("the edit-all-sources shortcut outlines every comparison source", async ({ page, editor }) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const toggleAllSources = `${toggleModifier}+e`;

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(editor)).toEqual(fixture.comparisonSourceIds);

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
});

test("show-all and hide-all keep explicitly shown source and instance outlines", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const controls = variationControls(page);
  const sourceKey = `source:${fixture.source.id}`;
  const instanceKey = `instance:${fixture.instance.id}`;

  await controls.getByRole("button", { name: "Show all source outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual(fixture.comparisonSourceIds);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect
    .poll(() => drawnOutlines(editor))
    .toEqual(fixture.comparisonSourceIds.filter((key) => key !== sourceKey));
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await controls.getByRole("button", { name: "Hide all source outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([sourceKey]);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);

  await outlineToggle(page, "Show", "instance", fixture.instance.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([instanceKey]);
  await controls.getByRole("button", { name: "Show all instance outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual(fixture.instanceIds);
  await controls.getByRole("button", { name: "Hide all instance outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([instanceKey]);
  await outlineToggle(page, "Hide", "instance", fixture.instance.name).click();
  await expect.poll(() => drawnOutlines(editor)).toEqual([]);
});

/** Returns a named instance whose location is not a source, so its outline has its own shape. */
async function interpolatedInstance(
  page: Page,
  editor: EditorDriver,
): Promise<{ id: string; name: string }> {
  const instanceId = await instanceBetweenSources(page);
  const instance = (await editor.fontOverview()).instances.find(({ id }) => id === instanceId);
  if (!instance) throw new Error("Expected an instance between sources");

  return { id: instance.id, name: instance.name };
}

test(
  "a comparison source outline matches snapshot",
  { tag: "@golden" },
  async ({ page, editor }) => {
    const fixture = await openOutlineFixture(page, editor);

    await outlineToggle(page, "Show", "source", fixture.source.name).click();
    await expect.poll(() => drawnOutlines(editor)).toEqual([`source:${fixture.source.id}`]);

    await expectCanvasSnapshot(editor, "outline-source.png");
  },
);

test(
  "an interpolated instance outline matches snapshot",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await openOutlineFixture(page, editor);
    const instance = await interpolatedInstance(page, editor);

    await outlineToggle(page, "Show", "instance", instance.name).click();
    await expect.poll(() => drawnOutlines(editor)).toEqual([`instance:${instance.id}`]);

    await expectCanvasSnapshot(editor, "outline-interpolated-instance.png");
  },
);
