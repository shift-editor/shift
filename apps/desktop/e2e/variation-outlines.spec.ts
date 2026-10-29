import type { NamedInstanceId, SourceId } from "@shift/types";
import type { Page } from "@playwright/test";
import { workspaceTest, expect, FONTS, navigateToEditor } from "./fixtures/electronApp";
import {
  editorSidebar,
  instanceRow,
  openVariationControls,
  sourceRow,
  variationControls,
} from "./fixtures/appLocators";
import type { EditorDriver } from "./fixtures/EditorDriver";
import type { OutlinePoint, OutlineTarget } from "@/testing/reads";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

const test = workspaceTest.extend({ startupFontPath: FONTS.mutatorSans });

const toggleModifier = process.platform === "darwin" ? "Meta" : "Control";

workspaceTest.describe("mapped weight interpolation", () => {
  workspaceTest.use({
    startupFontPath: FONTS.mappedWeight,
  });

  workspaceTest(
    "named instances display mapped user weights between masters",
    async ({ page, editor }) => {
      await editor.openGlyphByName("A");
      const controls = await openVariationControls(page);

      for (const [name, x, advance] of [
        ["ExtraLight", 50, 407.14285714285717],
        ["SemiBold", 110, 697.2972972972973],
      ] as const) {
        await instanceRow(controls, name).click();
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
  readonly source: { readonly id: SourceId; readonly name: string };
  /** The outline each comparison source draws, in the font's source order. */
  readonly comparisonSources: readonly OutlineTarget[];
  readonly instance: { readonly id: NamedInstanceId; readonly name: string };
  /** The outline each instance draws, in the font's instance order. */
  readonly instances: readonly OutlineTarget[];
}

/** Opens S with the Variations tab and returns the sources and instances it can outline. */
async function openOutlineFixture(page: Page, editor: EditorDriver): Promise<OutlineFixture> {
  await navigateToEditor(page, "53");
  await openVariationControls(page);

  const [{ sources, instances }, activeSource] = await Promise.all([
    editor.fontOverview(),
    editor.source("active"),
  ]);
  // The default source comes first and is the one open; the rest are comparison sources.
  const [first, ...comparisonSources] = sources;
  const [instance] = instances;
  expect(first).toEqual(activeSource);
  if (!activeSource || !comparisonSources[0] || !instance) {
    throw new Error("Expected variable sources and an instance");
  }

  return {
    activeSource: { id: activeSource.id, name: activeSource.name },
    source: { id: comparisonSources[0].id, name: comparisonSources[0].name },
    comparisonSources: comparisonSources.map(({ id }) => ({ kind: "source", sourceId: id })),
    instance: { id: instance.id, name: instance.name },
    instances: instances.map(({ id }) => ({ kind: "instance", instanceId: id })),
  };
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

test("moves matched points in every selected source as one edit", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  // LightCondensed is the open default source; BoldWide joins it for editing.
  const active = (await editor.source("active"))!.name;
  await editor.clickSource("BoldWide", "toggle");
  const glyph = (await editor.editorView()).glyph!.name;
  const pointsIn = async (source: string) =>
    (await editor.layerOf(glyph, source)).contours.flatMap((contour) => contour.points);
  // Which points moved between two reads of a layer, by how much; null for one that stayed.
  const moves = (before: readonly OutlinePoint[], after: readonly OutlinePoint[]) =>
    after.map((point, index) => {
      const was = before[index]!;
      return point.x === was.x && point.y === was.y
        ? null
        : { x: point.x - was.x, y: point.y - was.y };
    });

  const drag = await editor.selectVisiblePoint();
  const [referenceBefore, activeBefore, boldWideBefore] = await Promise.all([
    editor.point(drag.id),
    pointsIn(active),
    pointsIn("BoldWide"),
  ]);
  await editor.dragPoint(drag);
  const [referenceAfter, activeAfter, boldWideAfter] = await Promise.all([
    editor.point(drag.id),
    pointsIn(active),
    pointsIn("BoldWide"),
  ]);

  // The same points move in both sources, and BoldWide's match moves by the dragged delta.
  const activeMoves = moves(activeBefore, activeAfter);
  const boldWideMoves = moves(boldWideBefore, boldWideAfter);
  expect(boldWideMoves.map((move) => move !== null)).toEqual(
    activeMoves.map((move) => move !== null),
  );
  expect(boldWideMoves).toContainEqual({
    x: referenceAfter!.x - referenceBefore!.x,
    y: referenceAfter!.y - referenceBefore!.y,
  });

  await editor.undo();
  await expect.poll(() => editor.point(drag.id)).toEqual(referenceBefore);
  await expect.poll(() => pointsIn("BoldWide")).toEqual(boldWideBefore);
});

test("selects displayed objects at an interpolated instance", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  // Medium_Narrow_I sits between MutatorSans's sources.
  await instanceRow(controls, "Medium_Narrow_I").click();
  await expect.poll(() => editor.editorView()).toMatchObject({ activeSourceId: null });
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
  const sourceKey = { kind: "source", sourceId: fixture.source.id } as const;
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
  await expect(outlineToggle(page, "Show", "source", fixture.activeSource.name)).toHaveCount(0);

  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);
  await expect(sourceRow(controls, fixture.source.name)).toHaveAttribute("aria-pressed", "false");
  expect(await editor.editorView()).toMatchObject({ activeSourceId: fixture.activeSource.id });

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
});

test("editing-selection sources stay outlined until hidden, panning, or deselected", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = sourceRow(variationControls(page), fixture.source.name);
  const sourceKey = { kind: "source", sourceId: fixture.source.id } as const;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  expect(await editor.editorView()).toMatchObject({ activeSourceId: fixture.activeSource.id });
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);

  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);

  // Leaving and rejoining the editing selection forgets the per-row hide.
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await sourceButton.click({ modifiers: [toggleModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);

  // Holding Space over the canvas pans with the hand tool, which hides comparison outlines.
  await editor.canvas.hover();
  await page.keyboard.down("Space");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
  await page.keyboard.up("Space");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
});

test("an explicitly shown source outline survives leaving the editing selection", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = sourceRow(variationControls(page), fixture.source.name);
  const sourceKey = { kind: "source", sourceId: fixture.source.id } as const;

  await sourceButton.click({ modifiers: [toggleModifier] });
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);
});

test("the edit-all-sources shortcut outlines every comparison source", async ({ page, editor }) => {
  const fixture = await openOutlineFixture(page, editor);
  const sourceButton = sourceRow(variationControls(page), fixture.source.name);
  const toggleAllSources = `${toggleModifier}+e`;

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual(fixture.comparisonSources);

  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
});

test("show-all and hide-all keep explicitly shown source and instance outlines", async ({
  page,
  editor,
}) => {
  const fixture = await openOutlineFixture(page, editor);
  const controls = variationControls(page);
  const sourceKey = { kind: "source", sourceId: fixture.source.id } as const;
  const instanceKey = { kind: "instance", instanceId: fixture.instance.id } as const;

  await controls.getByRole("button", { name: "Show all source outlines", exact: true }).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual(fixture.comparisonSources);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual(fixture.comparisonSources.slice(1));
  await outlineToggle(page, "Show", "source", fixture.source.name).click();
  await controls.getByRole("button", { name: "Hide all source outlines", exact: true }).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([sourceKey]);
  await outlineToggle(page, "Hide", "source", fixture.source.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);

  await outlineToggle(page, "Show", "instance", fixture.instance.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([instanceKey]);
  await controls.getByRole("button", { name: "Show all instance outlines", exact: true }).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual(fixture.instances);
  await controls.getByRole("button", { name: "Hide all instance outlines", exact: true }).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([instanceKey]);
  await outlineToggle(page, "Hide", "instance", fixture.instance.name).click();
  await expect.poll(() => editor.drawnOutlineTargets()).toEqual([]);
});

test(
  "a comparison source outline matches snapshot",
  { tag: "@golden" },
  async ({ page, editor }) => {
    const fixture = await openOutlineFixture(page, editor);

    await outlineToggle(page, "Show", "source", fixture.source.name).click();
    await expect
      .poll(() => editor.drawnOutlineTargets())
      .toEqual([{ kind: "source", sourceId: fixture.source.id }]);

    await expectCanvasSnapshot(editor, "outline-source.png");
  },
);

test(
  "an interpolated instance outline matches snapshot",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await openOutlineFixture(page, editor);
    const instance = (await editor.instance({ name: "Medium_Narrow_I" }))!;

    await outlineToggle(page, "Show", "instance", instance.name).click();
    await expect
      .poll(() => editor.drawnOutlineTargets())
      .toEqual([{ kind: "instance", instanceId: instance.id }]);

    await expectCanvasSnapshot(editor, "outline-interpolated-instance.png");
  },
);
