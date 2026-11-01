import { CanvasHiddenError, type EditorViewport } from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { Point2D } from "@shift/geo";
import { localPoint, scenePoint, screenPoint, type ScenePoint } from "@shift/editor/spaces";

/**
 * The canvas camera in the units agents work in: the open glyph's units
 * (font units, y up) while a glyph is open, the shown page's otherwise.
 *
 * @remarks
 * The open glyph is the scene's first glyph node, the one
 * `EditorView.glyph` names, so a point read from `layers.get` can be centred
 * as it is.
 */
export class ShiftViewport {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Whether the canvas has a size, so it has a middle to centre on. */
  get shown(): boolean {
    return this.#middle() !== null;
  }

  /** The zoom, and the point at the middle of the canvas; null while the canvas has no size. */
  read(): EditorViewport {
    const editor = this.#editor;
    const zoom = editor.zoom;
    const middle = this.#middle();
    if (!middle) return { zoom, center: null };

    const node = editor.scene.first("glyph");
    const { x, y } = node ? editor.toLocal(node, middle) : middle;
    return { zoom, center: { x, y } };
  }

  /**
   * Pans the camera so `center` is at the middle of the canvas, keeping the zoom.
   *
   * @throws {CanvasHiddenError} while the canvas has no size.
   */
  centerOn(center: Point2D): void {
    const editor = this.#editor;
    if (!this.#middle()) throw new CanvasHiddenError();

    const node = editor.scene.first("glyph");
    const scene: ScenePoint = node
      ? editor.toScene(node, localPoint(center.x, center.y))
      : scenePoint(center.x, center.y);
    const { zoom, logicalWidth, logicalHeight } = editor.getCameraTransform();
    editor.setPan({ x: logicalWidth / 2 - scene.x * zoom, y: logicalHeight / 2 - scene.y * zoom });
  }

  #middle(): ScenePoint | null {
    const { logicalWidth, logicalHeight } = this.#editor.getCameraTransform();
    if (logicalWidth <= 0 || logicalHeight <= 0) return null;

    return this.#editor.screenToScene(screenPoint(logicalWidth / 2, logicalHeight / 2));
  }
}
