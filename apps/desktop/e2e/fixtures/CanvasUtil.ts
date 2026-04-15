import type { Page, Locator } from "@playwright/test";

/**
 * Utility for taking screenshots of individual canvas layers in the editor.
 *
 * The editor composites three canvases stacked on top of each other:
 *   - `#background-canvas` — guides, grid, metrics (rendering Theme guide colors)
 *   - `#scene-canvas`      — glyph geometry + rendering Theme fill/stroke
 *   - `#gpu-handles-canvas` — WebGL handle rendering (8 types × 3 states)
 *
 * Screenshotting individual layers isolates regressions: a handle-color change
 * only breaks the handles snapshot, not the full-page one.
 */
export class CanvasUtil {
  constructor(private page: Page) {}

  /** Screenshot the composited canvas container (all three layers). */
  async screenshotCanvasContainer(): Promise<Buffer> {
    const container = this.canvasContainer();
    return (await container.screenshot()) as Buffer;
  }

  /** Screenshot a single canvas layer by its DOM id. */
  async screenshotCanvasLayer(
    id: "background-canvas" | "scene-canvas" | "gpu-handles-canvas",
  ): Promise<Buffer> {
    const canvas = this.page.locator(`#${id}`);
    return (await canvas.screenshot()) as Buffer;
  }

  /** The parent element that wraps all three canvases. */
  private canvasContainer(): Locator {
    // All three canvases share a common parent inside EditorView.
    return this.page.locator("#scene-canvas").locator("..");
  }
}
