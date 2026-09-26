import type { Page } from "@playwright/test";
import {
  workspaceTest,
  documentTest,
  expect,
  FONT_PATH,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";
import { clickFirstCatalogGlyph, openVariationControls } from "./fixtures/appLocators";
import type { ExternalAxisLocation } from "@shift/editor/types";

const authoredTest = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });
const previewTest = documentTest.extend({ openFontPath: FONT_PATH });

interface DrawnHandles {
  /** Distinct handle states drawn, sorted. */
  readonly states: readonly string[];
  /** Handles drawn for the glyph node. */
  readonly count: number;
  /** Points in the glyph geometry at the current location. */
  readonly pointCount: number;
}

/** Reads the point handles the glyph node draws at the current location. */
async function drawnHandles(page: Page): Promise<DrawnHandles> {
  return page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    if (!node) return { states: [], count: 0, pointCount: 0 };

    const states = editor.nodeDefinition("glyph").handleStates(node);
    const geometry = editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation);
    return {
      states: [...new Set(states.values())].sort(),
      count: states.size,
      pointCount: geometry?.allPoints.length ?? 0,
    };
  });
}

async function expectEveryHandleDrawnAs(page: Page, states: readonly string[]): Promise<void> {
  await expect
    .poll(async () => {
      const handles = await drawnHandles(page);
      return { states: handles.states, complete: handles.count === handles.pointCount };
    })
    .toEqual({ states, complete: true });
}

authoredTest(
  "handles stay drawn with interpolated styling while scrubbing between sources",
  async ({ page }) => {
    await navigateToEditor(page, "53");
    await expectEveryHandleDrawnAs(page, ["idle"]);
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
        await expect
          .poll(() => page.evaluate(() => window.shiftSession!.editor.activeSourceId))
          .toBeNull();
        await expectEveryHandleDrawnAs(page, ["interpolated"]);
        values.push(await slider.getAttribute("aria-valuenow"));
      }
    } finally {
      await page.mouse.up();
    }
    expect(new Set(values).size).toBe(3);

    await slider.focus();
    await slider.press("Home");
    await expectEveryHandleDrawnAs(page, ["idle"]);
  },
);

authoredTest("named instances between sources draw interpolated handles", async ({ page }) => {
  await navigateToEditor(page, "53");
  const instance = await page.evaluate(() => {
    const font = window.shiftSession!.font;
    return font.namedInstances.find(
      (instance) =>
        !font.sourceAt(
          new Map(
            font
              .getAxes()
              .map((axis) => [axis.id, instance.location.values[axis.id] ?? axis.default]),
          ) as unknown as ExternalAxisLocation,
        ),
    );
  });
  if (!instance) throw new Error("Expected an instance between sources");
  const controls = await openVariationControls(page);

  await controls.getByTestId(`instance-${instance.id}`).click();

  await expectEveryHandleDrawnAs(page, ["interpolated"]);
});

previewTest(
  "TTF source handles keep source styling without becoming hoverable",
  async ({ page, electronApp }) => {
    const workspaceWindow = electronApp.waitForEvent("window");
    await page.getByRole("button", { name: /Load font/ }).click();
    const workspacePage = await workspaceWindow;
    await workspacePage.waitForURL(/#\/home$/);
    await clickFirstCatalogGlyph(workspacePage);
    await expectEveryHandleDrawnAs(workspacePage, ["idle"]);

    const point = await workspacePage.evaluate(() => {
      const editor = window.shiftSession!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const point = editor.glyphForId(node.glyphId)!.geometryAt(editor.externalLocation)
        .allPoints[0]!;
      return editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
    });
    const bounds = await workspacePage.locator("#interactive-canvas").boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");
    await workspacePage.mouse.move(bounds.x + point.x, bounds.y + point.y);

    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession!.editor.hover.id))
      .toBeNull();
    await expectEveryHandleDrawnAs(workspacePage, ["idle"]);
  },
);
