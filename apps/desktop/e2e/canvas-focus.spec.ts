import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { glyphProperties } from "./fixtures/appLocators";
import { clearSelection } from "./fixtures/editorInteractions";

// Canvas shortcuts fire only while the canvas owns keyboard focus. Each test leaves that
// ownership with a sidebar the way a real session can, puts the pointer back on the canvas,
// and expects the next tool shortcut to work without a detour through a sidebar.
test.describe("Canvas keyboard focus", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode("41");
  });

  test("returns to the canvas when focus moves into a sidebar under a resting pointer", async ({
    page,
    editor,
  }) => {
    const center = await editor.canvasPagePoint({ x: 0.5, y: 0.5 });
    await page.mouse.move(center.x, center.y, { steps: 3 });

    // Stands in for focus the pointer did not move: a menu handing focus back to its sidebar
    // trigger as it closes, or the window refocusing a sidebar control on activation.
    const zoomOptions = page.getByRole("button", { name: /^Zoom options/ });
    await zoomOptions.focus();
    await expect(zoomOptions).toBeFocused();

    await page.mouse.move(center.x + 20, center.y + 20, { steps: 5 });
    await page.keyboard.press("p");

    await expect(editor.toolButton("pen")).toHaveAttribute("aria-pressed", "true");
  });

  test("returns to the canvas after a focused sidebar field unmounts", async ({ page, editor }) => {
    const center = await editor.canvasPagePoint({ x: 0.5, y: 0.5 });
    await page.mouse.move(center.x, center.y);
    await editor.press("Control+a");
    const width = glyphProperties(page).getByRole("textbox", { name: "Width", exact: true });
    await width.click();
    await expect(width).toBeFocused();

    // Stands in for an undo, agent edit, or any other change that clears the selection while
    // the field is focused. The field unmounts without ever receiving blur.
    await clearSelection(page);
    await expect(width).toHaveCount(0);

    await page.mouse.move(center.x + 10, center.y + 10, { steps: 5 });
    await page.keyboard.press("p");

    await expect(editor.toolButton("pen")).toHaveAttribute("aria-pressed", "true");
  });

  test("keeps tool shortcuts off the canvas while the pointer is over a sidebar", async ({
    page,
    editor,
  }) => {
    const sidebar = await glyphProperties(page).boundingBox();
    if (!sidebar) throw new Error("Expected the glyph properties sidebar to be laid out");

    await page.mouse.move(sidebar.x + sidebar.width / 2, sidebar.y + 40, { steps: 5 });
    await page.keyboard.press("p");
    // The router handles "p" within the key event, so the tool has already settled here.
    await expect(editor.toolButton("pen")).toHaveAttribute("aria-pressed", "false");

    const center = await editor.canvasPagePoint({ x: 0.5, y: 0.5 });
    await page.mouse.move(center.x, center.y, { steps: 5 });
    await page.keyboard.press("p");

    await expect(editor.toolButton("pen")).toHaveAttribute("aria-pressed", "true");
  });

  test("keeps typed keys in a sidebar field while the pointer is over the canvas", async ({
    page,
    editor,
  }) => {
    const center = await editor.canvasPagePoint({ x: 0.5, y: 0.5 });
    await page.mouse.move(center.x, center.y);
    await editor.press("Control+a");
    const width = glyphProperties(page).getByRole("textbox", { name: "Width", exact: true });
    await width.click();
    await page.mouse.move(center.x, center.y, { steps: 5 });

    await page.keyboard.press("p");

    await expect(width).toBeFocused();
    await expect(editor.toolButton("select")).toHaveAttribute("aria-pressed", "true");
    await expect(editor.toolButton("pen")).toHaveAttribute("aria-pressed", "false");
  });

  test("releases the temporary Hand when Space is released over a sidebar", async ({
    page,
    editor,
  }) => {
    const center = await editor.canvasPagePoint({ x: 0.5, y: 0.5 });
    const sidebar = await glyphProperties(page).boundingBox();
    if (!sidebar) throw new Error("Expected the glyph properties sidebar to be laid out");

    await page.mouse.move(center.x, center.y);
    await page.keyboard.down("Space");
    await expect(editor.toolButton("hand")).toHaveAttribute("aria-pressed", "true");

    await page.mouse.move(sidebar.x + sidebar.width / 2, sidebar.y + 40, { steps: 5 });
    await page.keyboard.up("Space");
    await page.mouse.move(center.x, center.y, { steps: 5 });

    await expect(editor.toolButton("select")).toHaveAttribute("aria-pressed", "true");
    await expect(editor.toolButton("hand")).toHaveAttribute("aria-pressed", "false");
  });
});
