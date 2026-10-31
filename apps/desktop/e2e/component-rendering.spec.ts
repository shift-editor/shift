import { FONTS, workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import {
  editorSidebar,
  glyphProperties,
  instanceRow,
  openVariationControls,
} from "./fixtures/appLocators";
import { drawnAndAuthoredComponents, drawnComponentCount } from "./fixtures/editorInteractions";
import { expectCanvasSnapshot } from "./fixtures/snapshots";
import { localPoint } from "@shift/editor/spaces";

test.use({ startupFontPath: FONTS.mutatorSans });

test(
  "exact sources keep ordered component transforms when authored IDs differ",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await navigateToEditor(page, "C1");
    await editor.clickSource("BoldWide");

    const sample = await drawnAndAuthoredComponents(page, "Aacute", "BoldWide");

    expect(sample.renderedIds).not.toEqual(sample.exactIds);
    expect(sample.renderedTransforms).toEqual(sample.exactTransforms);

    // Keep the wide component's right edge inside the canvas.
    await editor.setZoom((await editor.zoomLevel()) * 0.8);
    await expectCanvasSnapshot(editor, "canvas-Aacute-bold-wide-components.png");
  },
);

test(
  "components render at an interpolated instance",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await navigateToEditor(page, "C1");
    const controls = await openVariationControls(page);
    // Medium_Narrow_I sits between MutatorSans's sources.

    await instanceRow(controls, "Medium_Narrow_I").click();
    await expect.poll(async () => (await editor.editorView()).activeSourceId).toBeNull();
    const componentCount = await drawnComponentCount(page);
    expect(componentCount).toBeGreaterThan(0);

    await expectCanvasSnapshot(editor, "canvas-Aacute-interpolated-components.png");
  },
);

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

  const center = localPoint(
    initialBounds.x + initialBounds.width / 2,
    initialBounds.y + initialBounds.height / 2,
  );
  const dragStart = await editor.projectGlyphToPage(center);
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
