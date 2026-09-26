import path from "node:path";
import type { MatModel } from "@shift/geo";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import { editorSidebar, glyphProperties, openVariationControls } from "./fixtures/appLocators";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

const VARIABLE_FONT_PATH = path.resolve(
  __dirname,
  "../../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

test.use({ startupFontPath: VARIABLE_FONT_PATH });

test("exact sources keep ordered component transforms when authored IDs differ", async ({
  page,
  editor,
}) => {
  await navigateToEditor(page, "C1");
  const sourceId = await page.evaluate(
    () => window.shift?.font.sources.find((candidate) => candidate.name === "BoldWide")?.id,
  );
  if (!sourceId) throw new Error("Expected BoldWide fixture source");
  await openVariationControls(page);
  await page.getByTestId(`source-${sourceId}`).click();
  await expect.poll(() => page.evaluate(() => window.shift?.editor.activeSourceId)).toBe(sourceId);

  const sample = await page.evaluate(() => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const record = workspace.font.recordForName("Aacute");
    if (!record) throw new Error("Expected Aacute fixture glyph");
    const source = workspace.font.sources.find((candidate) => candidate.name === "BoldWide");
    if (!source) throw new Error("Expected BoldWide fixture source");
    const glyph = workspace.editor.glyphForId(record.id);
    if (!glyph) throw new Error("Expected loaded Aacute glyph");

    const renderModel = glyph.renderModelAt(
      workspace.editor.externalLocationCell,
      workspace.editor.activeSourceIdCell,
    );
    const exactGeometry = glyph.geometryForSource(source.id);
    const directComponents = renderModel.components.filter(
      (component) => component.parentPath.length === 0,
    );
    const matrixValues = (matrix: MatModel) => [
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ];

    return {
      renderedIds: directComponents.map((component) => component.componentId),
      exactIds: exactGeometry.components.map((component) => component.id),
      renderedTransforms: directComponents.map((component) => matrixValues(component.transform)),
      exactTransforms: exactGeometry.components.map((component) => matrixValues(component.matrix)),
    };
  });

  expect(sample.renderedIds).not.toEqual(sample.exactIds);
  expect(sample.renderedTransforms).toEqual(sample.exactTransforms);

  await expectCanvasSnapshot(editor, "canvas-Aacute-bold-wide-components.png");
});

test("selected components expose editable transforms in the properties sidebar", async ({
  page,
  editor,
}) => {
  await navigateToEditor(page, "C1");
  await editor.openGlyphByName("Aacute");
  const component = editorSidebar(page).locator('[data-testid^="object-component"]').first();
  await expect(component).toBeVisible();
  await component.click();

  const properties = glyphProperties(page);
  const initialBounds = await editor.selectionBounds();
  const xInput = properties.getByLabel("X position", { exact: true });
  await expect(properties.getByText("Transform", { exact: true })).toBeVisible();
  await expect(properties.getByLabel("Scale factor", { exact: true })).toBeVisible();
  await expect(xInput).toHaveValue(String(Math.round(initialBounds.x)));

  const center = {
    x: initialBounds.x + initialBounds.width / 2,
    y: initialBounds.y + initialBounds.height / 2,
  };
  const dragStart = await editor.projectSceneToPage(center);
  await editor.pointerDown(dragStart);
  try {
    await editor.pointerMove({ x: dragStart.x + 25, y: dragStart.y + 15 }, 3);
    const previewBounds = await editor.selectionBounds();
    await expect(xInput).toHaveValue(String(Math.round(previewBounds.x)));
  } finally {
    await editor.pointerUp();
  }
  await editor.undo();
  await expect.poll(() => editor.selectionBounds()).toEqual(initialBounds);

  const targetX = Math.round(initialBounds.x) + 25;
  await editor.commitInputValue(xInput, targetX);
  await expect.poll(() => editor.selectionBounds()).toMatchObject({ x: targetX });

  await editor.undo();
  await expect.poll(() => editor.selectionBounds()).toEqual(initialBounds);
});
