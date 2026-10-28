import {
  workspaceTest,
  documentTest,
  expect,
  FONTS,
  navigateToEditor,
} from "./fixtures/electronApp";
import { clickFirstCatalogGlyph, openVariationControls } from "./fixtures/appLocators";
import { EditorDriver } from "./fixtures/EditorDriver";
import {
  drawnPointCount,
  glyphClickTargets,
} from "./fixtures/editorInteractions";
import { expectCanvasSnapshot } from "./fixtures/snapshots";

const authoredTest = workspaceTest.extend({ startupFontPath: FONTS.mutatorSans });
const previewTest = documentTest.extend({ openFontPath: FONTS.mutatorSansTtf });

interface DrawnHandles {
  /** Distinct handle states drawn, sorted. */
  readonly states: readonly string[];
  /** Handles drawn for the glyph node. */
  readonly count: number;
  /** Points in the glyph geometry at the current location. */
  readonly pointCount: number;
}

/** Reads the point handles the glyph node draws at the current location. */
async function drawnHandles(editor: EditorDriver): Promise<DrawnHandles> {
  const handles = await editor.drawnHandles();
  return {
    states: [...new Set(handles.map((handle) => handle.state))].sort(),
    count: handles.length,
    pointCount: await drawnPointCount(editor.page),
  };
}

async function expectEveryHandleDrawnAs(
  editor: EditorDriver,
  states: readonly string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const handles = await drawnHandles(editor);
      return { states: handles.states, complete: handles.count === handles.pointCount };
    })
    .toEqual({ states, complete: true });
}

authoredTest(
  "handles stay drawn with interpolated styling while scrubbing between sources",
  async ({ page, editor }) => {
    await navigateToEditor(page, "53");
    await expectEveryHandleDrawnAs(editor, ["idle"]);
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
        await expectEveryHandleDrawnAs(editor, ["interpolated"]);
        values.push(await slider.getAttribute("aria-valuenow"));
      }
    } finally {
      await page.mouse.up();
    }
    expect(new Set(values).size).toBe(3);

    await slider.focus();
    await slider.press("Home");
    await expectEveryHandleDrawnAs(editor, ["idle"]);
  },
);

authoredTest(
  "named instances between sources draw interpolated handles",
  { tag: "@golden" },
  async ({ page, editor }) => {
    await navigateToEditor(page, "53");
    // Medium_Narrow_I sits between MutatorSans's sources.
    const instanceId = (await editor.instance({ name: "Medium_Narrow_I" }))!.id;
    const controls = await openVariationControls(page);

    await controls.getByTestId(`instance-${instanceId}`).click();

    await expectEveryHandleDrawnAs(editor, ["interpolated"]);
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
    await expectEveryHandleDrawnAs(workspace, ["idle"]);

    // The glyph's first point as the canvas draws it.
    const [point] = await glyphClickTargets(workspacePage);
    if (!point) throw new Error("Expected the glyph's first point");
    const bounds = await workspace.canvasBounds();
    await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);

    await expect.poll(() => workspace.hoverId()).toBeNull();
    await expectEveryHandleDrawnAs(workspace, ["idle"]);
  },
);
