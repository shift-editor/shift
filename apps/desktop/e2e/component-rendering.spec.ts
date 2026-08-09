import path from "node:path";
import type { MatModel } from "@shift/geo";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

const VARIABLE_FONT_PATH = path.resolve(
  __dirname,
  "../../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

test.use({ startupFontPath: VARIABLE_FONT_PATH });

test("exact sources keep ordered component transforms when authored IDs differ", async ({
  page,
}) => {
  await navigateToEditor(page, "C1");

  const sample = await page.evaluate(() => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const record = workspace.font.recordForName("Aacute");
    if (!record) throw new Error("Expected Aacute fixture glyph");
    const source = workspace.font.sources.find((candidate) => candidate.name === "BoldWide");
    if (!source) throw new Error("Expected BoldWide fixture source");
    const glyph = workspace.editor.glyphForId(record.id);
    if (!glyph) throw new Error("Expected loaded Aacute glyph");

    workspace.editor.selectSource(source.id);
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

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const canvas = new CanvasUtil(page);
  const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
  await expect(screenshot).toMatchSnapshot("canvas-Aacute-bold-wide-components.png");
});
