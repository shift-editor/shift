import { Bounds, Mat, type Rect2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { FrameNode } from "../../types/node";
import type { FrameAxis, Sizing } from "../../types/frame";
import type { TransformAction, TransformEdit, TransformTarget } from "../../types/transformTarget";

/** Smallest change in size, in scene units, that counts as resizing an axis. */
const RESIZE_EPSILON = 1e-6;

/**
 * Moves and resizes a selected frame from the transform box.
 *
 * @remarks
 * Resizing sets each resized axis to a fixed size and never scales the
 * frame's content: the page layout reflows the children into the new size.
 * Moving and the left and top handles change the frame's position, which
 * only a frame on a page has; inside another frame the parent places it.
 * Rotating does nothing. Every preview writes the node record, so the page
 * relays out live; a gesture's capture makes the drag one undo step.
 */
export class FrameTransform implements TransformTarget {
  readonly #editor: Editor;
  readonly #frame: FrameNode;

  /**
   * @param frame - the selected frame.
   * @param bounds - the frame's laid-out box in its own units.
   */
  constructor(
    editor: Editor,
    frame: FrameNode,
    readonly bounds: Rect2D,
  ) {
    this.#editor = editor;
    this.#frame = frame;
  }

  begin(action: TransformAction): TransformEdit {
    const editor = this.#editor;
    const frame = this.#frame;
    const original = Bounds.fromXYWH(0, 0, this.bounds.width, this.bounds.height);
    const onPage = editor.scene.parent(frame.id)?.kind === "page";
    const write = (update: Partial<Pick<FrameNode, "position" | "width" | "height">>) =>
      editor.history.captureOrJoin("Resize frame", () =>
        editor.scene.updateNode({ id: frame.id, ...update }),
      );

    return {
      preview: (deltaFor) => {
        if (action === "rotate") return;

        const delta = deltaFor({ bounds: this.bounds });
        const corners = [original.min, original.max].map((corner) =>
          Mat.applyToPoint(delta, corner),
        );
        const next = Bounds.fromPoints(corners);
        if (!next) return;

        const moved = { x: frame.position.x + next.min.x, y: frame.position.y + next.min.y };
        write({
          position: onPage ? moved : frame.position,
          width: resized(frame.width, Bounds.width(original), Bounds.width(next)),
          height: resized(frame.height, Bounds.height(original), Bounds.height(next)),
        });
      },
      // Previews already wrote the record inside the gesture's capture.
      commit: () => {},
      discard: () => write({ position: frame.position, width: frame.width, height: frame.height }),
    };
  }

  /** Double-clicking a resize handle: the handle's axes go back to hugging their content. */
  fitToContent(axes: readonly FrameAxis[]): void {
    const editor = this.#editor;
    editor.history.captureOrJoin("Resize frame to fit", () => {
      for (const axis of axes) editor.frames.setSizing(this.#frame.id, axis, { kind: "hug" });
    });
  }
}

/** The sizing after a resize: fixed at the new size when it changed, else as it was. */
function resized(sizing: Sizing, before: number, after: number): Sizing {
  if (Math.abs(after - before) <= RESIZE_EPSILON) return sizing;

  return { kind: "fixed", size: Math.max(0, after) };
}
