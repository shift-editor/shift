import {
  workspaceTest,
  documentTest,
  expect,
  FONTS,
  navigateToEditor,
} from "./fixtures/electronApp";
import { clickFirstCatalogGlyph, instanceRow, openVariationControls } from "./fixtures/appLocators";
import { EditorDriver } from "./fixtures/EditorDriver";
import { drawnPointCount, glyphClickTargets } from "./fixtures/editorInteractions";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

const authoredTest = workspaceTest.extend({ startupFontPath: FONTS.mutatorSans });
const previewTest = documentTest.extend({ openFontPath: FONTS.mutatorSansTtf });

/**
 * Waits until the canvas draws a handle for every point the open glyph draws at the editor's
 * location, each styled `state`, in outline order.
 */
async function expectEveryHandleDrawnAs(
  editor: EditorDriver,
  state: "idle" | "interpolated",
): Promise<void> {
  await expect(async () => {
    const [handles, pointCount] = await Promise.all([
      editor.drawnHandles(),
      drawnPointCount(editor.page),
    ]);
    expect(handles.map((handle) => handle.state)).toEqual(
      Array.from({ length: pointCount }, () => state),
    );
  }).toPass();
}

authoredTest(
  "handles stay drawn with interpolated styling while scrubbing between sources",
  async ({ page, editor }) => {
    await navigateToEditor(page, "53");
    await expectEveryHandleDrawnAs(editor, "idle");
    const controls = await openVariationControls(page);
    // Collapse the record lists so the axis controls sit inside the fixed-size window.
    await controls.getByRole("button", { name: "Sources", exact: true }).click();
    await controls.getByRole("button", { name: "Instances", exact: true }).click();
    const slider = controls.getByRole("slider", { name: "width", exact: true });
    // The slider role belongs to the thumb input, so scrub by offsets from the thumb centre.
    const thumb = await slider.boundingBox();
    if (!thumb) throw new Error("Expected width slider thumb bounds");

    const start = { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 };
    const values: (string | null)[] = [];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      // Offsets stay inside the short sidebar track, between the width sources.
      for (const offset of [10, 15, 20]) {
        await page.mouse.move(start.x + offset, start.y, { steps: 3 });
        await expect.poll(async () => (await editor.editorView()).activeSourceId).toBeNull();
        await expectEveryHandleDrawnAs(editor, "interpolated");
        values.push(await slider.getAttribute("aria-valuenow"));
      }
    } finally {
      await page.mouse.up();
    }
    expect(new Set(values).size).toBe(3);

    await slider.focus();
    await slider.press("Home");
    await expectEveryHandleDrawnAs(editor, "idle");
  },
);

authoredTest(
  "named instances between sources draw interpolated handles",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await navigateToEditor(page, "53");
    // Medium_Narrow_I sits between MutatorSans's sources.
    const controls = await openVariationControls(page);

    await instanceRow(controls, "Medium_Narrow_I").click();

    await expectEveryHandleDrawnAs(editor, "interpolated");
    await expectCanvasSnapshot(editor, "handles-interpolated-instance.png");
  },
);

previewTest(
  "TTF source handles keep source styling without becoming hoverable",
  async ({ page, electronApp }) => {
    const workspaceWindow = electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "Open Font…", exact: true }).click();
    const workspacePage = await workspaceWindow;
    await workspacePage.waitForURL(/#\/home$/);
    await clickFirstCatalogGlyph(workspacePage);
    const workspace = new EditorDriver(workspacePage, electronApp);
    await expectEveryHandleDrawnAs(workspace, "idle");

    // The glyph's first point as the canvas draws it.
    const [point] = await glyphClickTargets(workspacePage);
    if (!point) throw new Error("Expected the glyph's first point");
    const bounds = await workspace.canvasBounds();
    await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);

    await expect.poll(() => workspace.hoverId()).toBeNull();
    await expectEveryHandleDrawnAs(workspace, "idle");
  },
);
