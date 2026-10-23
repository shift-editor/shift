import { Bounds, Mat, type Rect2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { Sizing, TextRunNode } from "../../types/node";
import type {
  SizeAxis,
  TransformAction,
  TransformEdit,
  TransformTarget,
} from "../../types/transformTarget";

/** Smallest change in a side, in the run's units, that counts as resizing it. */
const RESIZE_EPSILON = 1e-6;

/**
 * Moves, sizes, and turns a selected text box from the transform box.
 *
 * @remarks
 * Works in the box's own axes, so a turned box resizes along its sides.
 * Resizing never scales the text: each changed side is fixed at its new
 * length (a corner fixes both) and the lines wrap again; a fixed height can
 * leave text past the bottom.
 * Turning sets the box's rotation and moves its corner so the box turns about
 * the transform box's pivot. Every preview writes the node record, so a
 * gesture's capture makes the drag one undo step.
 */
export class TextBoxTransform implements TransformTarget {
  readonly #editor: Editor;
  readonly #node: TextRunNode;

  /**
   * @param node - the selected text box.
   * @param bounds - the box in the run's own units (Y-up font units).
   */
  constructor(
    editor: Editor,
    node: TextRunNode,
    readonly bounds: Rect2D,
  ) {
    this.#editor = editor;
    this.#node = node;
  }

  begin(action: TransformAction): TransformEdit {
    const editor = this.#editor;
    const node = this.#node;
    const runs = editor.nodeDefinition("textRun");
    const original = Bounds.fromXYWH(
      this.bounds.x,
      this.bounds.y,
      this.bounds.width,
      this.bounds.height,
    );
    const units = runs.unitsTransform(node);
    const upright = runs.unitsTransform({ ...node, rotation: 0 });
    const scale = Math.hypot(units.a, units.b);
    const write = (
      update: Partial<Pick<TextRunNode, "position" | "width" | "height" | "rotation">>,
    ) =>
      editor.history.captureOrJoin("Transform text", () =>
        editor.scene.updateNode({
          id: node.id,
          ...update,
        }),
      );

    return {
      preview: (deltaFor) => {
        const delta = deltaFor({ bounds: this.bounds });

        if (action === "rotate") {
          // Where the delta takes the box, in its parent's frame, with the upright units taken off.
          const turned = Mat.Compose(
            Mat.Compose(Mat.Translate(node.position.x, node.position.y), units),
            Mat.Compose(delta, Mat.Inverse(upright)),
          );
          write({
            position: { x: turned.e, y: turned.f },
            rotation: Math.atan2(turned.b, turned.a),
          });
          return;
        }

        const corners = [original.min, original.max].map((corner) =>
          Mat.applyToPoint(delta, corner),
        );
        const next = Bounds.fromPoints(corners);
        if (!next) return;

        // The box's top-left corner, from the run's Y-up units into the node's frame.
        const corner = Mat.applyToPoint(units, { x: next.min.x, y: next.max.y });
        write({
          position: { x: node.position.x + corner.x, y: node.position.y + corner.y },
          width: resized(node.width, Bounds.width(original), Bounds.width(next), scale),
          height: resized(node.height, Bounds.height(original), Bounds.height(next), scale),
        });
      },
      // Previews already wrote the record inside the gesture's capture.
      commit: () => {},
      discard: () =>
        write({
          position: node.position,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        }),
    };
  }

  /** Double-clicking a handle: the box fits its text again along the handle's sides. */
  fitToContent(axes: readonly SizeAxis[]): void {
    const editor = this.#editor;
    const hug: Sizing = { kind: "hug" };
    editor.history.captureOrJoin("Resize text to fit", () =>
      editor.scene.updateNode({
        id: this.#node.id,
        ...(axes.includes("width") ? { width: hug } : {}),
        ...(axes.includes("height") ? { height: hug } : {}),
      }),
    );
  }
}

function changed(before: number, after: number): boolean {
  return Math.abs(after - before) > RESIZE_EPSILON;
}

/** A side's sizing after a resize: fixed at the new length when it changed, else as it was. */
function resized(sizing: Sizing, before: number, after: number, scale: number): Sizing {
  if (!changed(before, after)) return sizing;

  return { kind: "fixed", size: Math.max(0, after) * scale };
}
