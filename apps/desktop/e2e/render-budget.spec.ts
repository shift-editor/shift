/**
 * Re-render budgets for the editor's continuous interactions.
 *
 * A weight scrub or a marquee commits React on every pointer move. When a
 * broad subscription makes each commit re-render the sidebars, fast machines
 * still hold 60 fps while a Linux laptop drops to 30. Render counts do not
 * depend on the GPU, so these budgets hold in software-rendered CI. On failure
 * the message lists which components started the renders and what changed;
 * `pnpm profile:desktop` reproduces the same report on a packaged build.
 */
import { DESIGNSPACE_FONT_PATH, expect, workspaceTest } from "./fixtures/electronApp";
import { editorShell, openVariationControls } from "./fixtures/appLocators";
import {
  installRenderCounter,
  startRenderCount,
  stopRenderCount,
  type RenderCount,
} from "./fixtures/renderCounter.mjs";

const test = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });

/** Pointer moves per interaction; enough commits for a stable mean. */
const MOVES = 60;

/**
 * Mean component renders per commit allowed during each interaction, about 15%
 * over what they measured when set (61, 117, and 47). Kept tight on purpose: on
 * this small font, writing a new-but-equal editing-sources set on every scrub
 * step only raised the scrub to 81. Raise a budget deliberately when an
 * interaction should show more.
 */
const BUDGET = { scrub: 70, marquee: 135, boxDrag: 54 };

test.describe("render budget", () => {
  test.beforeEach(async ({ page, editor }) => {
    await editor.openGlyphByName("A");
    await installRenderCounter(page, () => expect(editorShell(page)).toBeVisible());
  });

  test("scrubbing the weight axis re-renders only what shows the location", async ({ page }) => {
    const controls = await openVariationControls(page);
    // Collapse the record lists so the axis controls sit inside the fixed-size window.
    await controls.getByRole("button", { name: "Sources", exact: true }).click();
    await controls.getByRole("button", { name: "Instances", exact: true }).click();
    const thumb = controls.getByRole("slider", { name: "weight", exact: true });
    await expect(thumb).toBeVisible();
    const track = await thumb.locator("xpath=ancestor::*[@data-orientation][1]").boundingBox();
    const handle = await thumb.boundingBox();
    if (!track || !handle) throw new Error("the weight slider has no layout box");

    const y = handle.y + handle.height / 2;
    await startRenderCount(page);
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    for (let move = 0; move < MOVES; move++) {
      const t = (Math.sin(move / 8) + 1) / 2;
      await page.mouse.move(track.x + 4 + t * (track.width - 8), y);
    }
    await page.mouse.up();

    expectWithinBudget(await stopRenderCount(page), BUDGET.scrub);
  });

  test("dragging a text box re-renders only what shows the box", async ({ page, editor }) => {
    await editor.selectTool("select");
    // A box away from the page run, selected so the sidebar shows its Text section.
    const run = await page.evaluate(() => {
      const editor = window.shift!.editor;
      editor.exitNodes();
      const node = editor.scene.createNode({
        kind: "textRun",
        runId: editor.text.createRun(editor.text.itemsFromText("AAA")).id,
        size: 400,
        width: { kind: "hug" },
        height: { kind: "hug" },
        rotation: 0,
        verticalAlign: "top",
        position: { x: 2000, y: 0 },
      });
      editor.selection.select([node.id]);
      return { id: node.id, x: node.position.x };
    });
    await page.evaluate(async () => {
      const editor = window.shift!.editor;
      // The box has no bounds to zoom to until its glyphs have loaded and it has laid out.
      await editor.text.settled();
      editor.zoomToSelection();
    });
    await editor.waitForCanvasRender();
    const press = await page.evaluate((id) => {
      const editor = window.shift!.editor;
      const bounds = editor.nodeBounds(editor.scene.nodeOfKind(id, "textRun")!)!;
      return { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
    }, run.id);
    const start = await editor.projectSceneToPage(press);

    await startRenderCount(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let move = 1; move <= MOVES; move++) {
      await page.mouse.move(start.x + 8 + move * 2, start.y);
    }
    await page.mouse.up();
    await editor.flushPointerMoves();
    await editor.waitForIdle();
    const count = await stopRenderCount(page);

    const moved = await page.evaluate(
      (id) => window.shift!.editor.scene.nodeOfKind(id, "textRun")!.position.x,
      run.id,
    );
    expect(moved, "the drag should move the box").toBeGreaterThan(run.x);
    expectWithinBudget(count, BUDGET.boxDrag);
  });

  test("a marquee re-renders only what shows the selection", async ({ page }) => {
    const canvas = await page.locator('[data-shift-capture-target="editor"]').boundingBox();
    if (!canvas) throw new Error("the editor canvas has no layout box");

    await startRenderCount(page);
    await page.mouse.move(canvas.x + 24, canvas.y + 24);
    await page.mouse.down();
    for (let move = 0; move < MOVES; move++) {
      const t = (Math.sin(move / 8) + 1) / 2;
      await page.mouse.move(
        canvas.x + 24 + t * (canvas.width - 48),
        canvas.y + 24 + t * (canvas.height - 48),
      );
    }
    await page.mouse.up();

    expectWithinBudget(await stopRenderCount(page), BUDGET.marquee);
  });
});

function expectWithinBudget(count: RenderCount, budget: number): void {
  test.info().annotations.push({
    type: "renders per commit",
    description: `${count.perCommit} over ${count.commits} commits (budget ${budget})`,
  });
  expect(count.commits, "the interaction should commit React").toBeGreaterThan(0);
  const startedBy = count.starts.map(([start, renders]) => `${renders} ${start}`).join("\n");
  expect(
    count.perCommit,
    `mean renders per commit over ${count.commits} commits; renders started by:\n${startedBy}`,
  ).toBeLessThanOrEqual(budget);
}
