import type { Locator, Page } from "@playwright/test";
import type { Point2D } from "@shift/types";

/**
 * Utility for taking screenshots of individual canvas layers in the editor.
 *
 * The editor composites three canvases stacked on top of each other:
 *   - `#background-canvas` — guides, grid, metrics (rendering Theme guide colors)
 *   - `#scene-canvas`      — glyph geometry + rendering Theme fill/stroke
 *   - `#marker-canvas`     — WebGL handle rendering (8 types × 3 states)
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
    id: "background-canvas" | "scene-canvas" | "marker-canvas",
  ): Promise<Buffer> {
    const canvas = this.page.locator(`#${id}`);
    return (await canvas.screenshot()) as Buffer;
  }

  /**
   * Converts a normalized interactive-canvas position to page coordinates.
   *
   * @param relativePosition - Fractions from zero to one along the canvas width and height.
   * @returns Rounded page coordinates in CSS pixels.
   * @throws {Error} When either fraction is out of range or the canvas has no layout bounds.
   */
  async interactivePagePoint(relativePosition: Point2D): Promise<Point2D> {
    if (
      relativePosition.x < 0 ||
      relativePosition.x > 1 ||
      relativePosition.y < 0 ||
      relativePosition.y > 1
    ) {
      throw new Error("Interactive canvas positions must be normalized between zero and one");
    }

    const bounds = await this.page.locator("#interactive-canvas").boundingBox();
    if (!bounds) throw new Error("Expected interactive canvas bounds");

    return {
      x: Math.round(bounds.x + bounds.width * relativePosition.x),
      y: Math.round(bounds.y + bounds.height * relativePosition.y),
    };
  }

  /**
   * Returns the live locator for the element compositing all editor canvas layers.
   *
   * @returns A locator resolved against the current editor view.
   */
  canvasContainer(): Locator {
    // All three canvases share a common parent inside EditorView.
    return this.page.locator("#scene-canvas").locator("..");
  }
}
