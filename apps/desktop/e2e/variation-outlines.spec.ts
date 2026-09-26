import type { Page } from "@playwright/test";
import {
  workspaceTest,
  expect,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";
import { editorSidebar, openVariationControls, variationControls } from "./fixtures/appLocators";

const test = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });

const toggleModifier = process.platform === "darwin" ? "Meta" : "Control";

interface OutlineFixture {
  readonly activeSource: { readonly id: string; readonly name: string };
  readonly source: { readonly id: string; readonly name: string };
  readonly comparisonSourceIds: readonly string[];
  readonly instance: { readonly id: string; readonly name: string };
  readonly instanceIds: readonly string[];
}

/** Opens S with the Variations tab and returns the sources and instances it can outline. */
async function openOutlineFixture(page: Page): Promise<OutlineFixture> {
  await navigateToEditor(page, "53");
  await openVariationControls(page);

  const fixture = await page.evaluate(() => {
    const { editor, font } = window.shiftSession!;
    const activeSource = font.sources.find(({ id }) => id === editor.activeSourceId);
    const comparisonSources = font.sources.filter(({ id }) => id !== editor.activeSourceId);
    const instance = font.namedInstances[0];
    if (!activeSource || !comparisonSources[0] || !instance) return null;

    return {
      activeSource: { id: activeSource.id, name: activeSource.name },
      source: { id: comparisonSources[0].id, name: comparisonSources[0].name },
      comparisonSourceIds: comparisonSources.map(({ id }) => `source:${id}`).sort(),
      instance: { id: instance.id, name: instance.name },
      instanceIds: font.namedInstances.map(({ id }) => `instance:${id}`).sort(),
    };
  });
  if (!fixture) throw new Error("Expected variable sources and an instance");

  return fixture;
}

/** Returns the comparison outlines the glyph node draws, as sorted `kind:id` keys. */
async function drawnOutlines(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    if (!node) return [];

    return editor
      .nodeDefinition("glyph")
      .visibleOutlines(node.id)
      .map((target) =>
        target.kind === "source" ? `source:${target.sourceId}` : `instance:${target.instanceId}`,
      )
      .sort();
  });
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

async function activeSourceId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.shiftSession!.editor.activeSourceId);
}

test("moves matched points in every selected source as one edit", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const source = await page.evaluate(() => {
    const session = window.shiftSession!;
    return session.font.sources.find(({ id }) => id !== session.editor.activeSourceId);
  });
  if (!source) throw new Error("Expected comparison source");

  await controls
    .getByTestId(`source-${source.id}`)
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect
    .poll(() =>
      page.evaluate(() => window.shiftSession!.editor.editingLayerMatchesCell.peek().size),
    )
    .toBe(1);

  const drag = await editor.selectVisiblePoint();
  const referenceBefore = await editor.pointPosition(drag.id);
  const target = await page.evaluate((referencePointId) => {
    const session = window.shiftSession!;
    const [layerMatch] = session.editor.editingLayerMatchesCell.peek().values();
    if (!layerMatch?.complete) throw new Error("Expected complete layer match");
    const targetPointId = layerMatch.points.find(
      ({ referenceId }) => referenceId === referencePointId,
    )?.targetId;
    const node = session.editor.scene.nodesOfKind("glyph")[0];
    const targetLayer = node
      ? session.editor.glyphForId(node.glyphId)?.layerForId(layerMatch.targetLayerId)
      : null;
    const point = targetPointId ? targetLayer?.point(targetPointId) : null;
    if (!targetPointId || !point) throw new Error("Expected matched target point");

    return {
      layerId: layerMatch.targetLayerId,
      pointId: targetPointId,
      position: { x: point.x, y: point.y },
    };
  }, drag.id);

  await editor.dragPoint(drag);
  const referenceAfter = await editor.pointPosition(drag.id);
  const targetAfter = await page.evaluate(({ layerId, pointId }) => {
    const node = window.shiftSession!.editor.scene.nodesOfKind("glyph")[0];
    const point = node
      ? window.shiftSession!.editor.glyphForId(node.glyphId)?.layerForId(layerId)?.point(pointId)
      : null;
    if (!point) throw new Error("Expected matched target point");

    return { x: point.x, y: point.y };
  }, target);
  expect(targetAfter).toEqual({
    x: target.position.x + referenceAfter.x - referenceBefore.x,
    y: target.position.y + referenceAfter.y - referenceBefore.y,
  });

  await editor.undo();
  await expect.poll(() => editor.pointPosition(drag.id)).toEqual(referenceBefore);
  await expect
    .poll(() =>
      page.evaluate(({ layerId, pointId }) => {
        const node = window.shiftSession!.editor.scene.nodesOfKind("glyph")[0];
        const point = node
          ? window
              .shiftSession!.editor.glyphForId(node.glyphId)
              ?.layerForId(layerId)
              ?.point(pointId)
          : null;
        return point ? { x: point.x, y: point.y } : null;
      }, target),
    )
    .toEqual(target.position);
});

test("selects displayed objects at an interpolated instance", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const instanceId = await page.evaluate(() => {
    const font = window.shiftSession!.font;
    return font.namedInstances.find(
      (instance) =>
        !font.sourceAt(
          new Map(
            font
              .getAxes()
              .map((axis) => [axis.id, instance.location.values[axis.id] ?? axis.default]),
          ),
        ),
    )?.id;
  });
  if (!instanceId) throw new Error("Expected an interpolated instance");

  await controls.getByTestId(`instance-${instanceId}`).click();
  await expect
    .poll(() => page.evaluate(() => window.shiftSession!.editor.activeSourceId))
    .toBeNull();
  const pointId = await page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
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
}) => {
  const fixture = await openOutlineFixture(page);
  const controls = variationControls(page);
  const sourceKey = `source:${fixture.source.id}`;
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
  await expect(outlineToggle(page, "Show", "source", fixture.activeSource.name)).toHaveCount(0);

  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);
  await expect(controls.getByTestId(`source-${fixture.source.id}`)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await activeSourceId(page)).toBe(fixture.activeSource.id);

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
});

test("editing-selection sources stay outlined until hidden, panning, or deselected", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const sourceKey = `source:${fixture.source.id}`;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  expect(await activeSourceId(page)).toBe(fixture.activeSource.id);
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(page)).toEqual([]);

  // Leaving and rejoining the editing selection forgets the per-row hide.
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);

  // Holding Space over the canvas pans with the hand tool, which hides comparison outlines.
  await editor.canvas.hover();
  await page.keyboard.down("Space");
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
  await page.keyboard.up("Space");
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
});

test("an explicitly shown source outline survives leaving the editing selection", async ({
  page,
}) => {
  const fixture = await openOutlineFixture(page);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const sourceKey = `source:${fixture.source.id}`;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);
});

test("the edit-all-sources shortcut outlines every comparison source", async ({ page }) => {
  const fixture = await openOutlineFixture(page);
  const sourceButton = variationControls(page).getByTestId(`source-${fixture.source.id}`);
  const toggleAllSources = `${toggleModifier}+e`;

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => drawnOutlines(page)).toEqual(fixture.comparisonSourceIds);

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
});

test("show-all and hide-all keep explicitly shown source and instance outlines", async ({
  page,
}) => {
  const fixture = await openOutlineFixture(page);
  const controls = variationControls(page);
  const sourceKey = `source:${fixture.source.id}`;
  const instanceKey = `instance:${fixture.instance.id}`;

  await controls.getByRole("button", { name: "Show all source outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(page)).toEqual(fixture.comparisonSourceIds);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect
    .poll(() => drawnOutlines(page))
    .toEqual(fixture.comparisonSourceIds.filter((key) => key !== sourceKey));
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await controls.getByRole("button", { name: "Hide all source outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([sourceKey]);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([]);

  await outlineToggle(page, "Show", "instance", fixture.instance.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([instanceKey]);
  await controls.getByRole("button", { name: "Show all instance outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(page)).toEqual(fixture.instanceIds);
  await controls.getByRole("button", { name: "Hide all instance outlines", exact: true }).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([instanceKey]);
  await outlineToggle(page, "Hide", "instance", fixture.instance.name).click();
  await expect.poll(() => drawnOutlines(page)).toEqual([]);
});
