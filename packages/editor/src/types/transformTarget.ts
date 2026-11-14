import type { MatModel, Point2D, Rect2D } from "@shift/geo";

/** What the transform box is doing; targets pick their undo label and spacing rule from it. */
export type TransformAction = "move" | "scale" | "rotate";

/** One independently pivoted part of a transform, such as one edited source's components. */
export interface TransformPart {
  /** The part's bounds in the selection node's units. */
  readonly bounds: Rect2D;
}

/**
 * A selection the transform box can move, scale, and rotate as a whole.
 *
 * @remarks
 * Node definitions resolve these (`NodeDefinition.transformTarget`), so Select's
 * behaviors only compute matrices and never branch on what is selected.
 */
export interface TransformTarget {
  /** Box enclosing the selection, in the selection node's units. */
  readonly bounds: Rect2D;

  /**
   * The point that lands on a grid intersection when the target moves, in the selection
   * node's units, such as the first selected component's offset; null when moves never snap.
   */
  readonly gridOrigin: Point2D | null;

  /** Opens one preview cycle; finish it with `commit` or `discard`. */
  begin(action: TransformAction): TransformEdit;
}

/** One reversible preview and commit cycle opened by {@link TransformTarget.begin}. */
export interface TransformEdit {
  /**
   * Previews a delta against the state captured at `begin`, so previews never accumulate.
   *
   * @param deltaFor - Returns the delta, in the selection node's units, for one part.
   */
  preview(deltaFor: (part: TransformPart) => MatModel): void;

  /** Commits the latest preview as one undo step. */
  commit(): void;

  /** Restores the state captured at `begin`. */
  discard(): void;
}
