import type { MatModel, Rect2D } from "@shift/geo";

/** A box's width or height. */
export type SizeAxis = "width" | "height";

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

  /** Opens one preview cycle; finish it with `commit` or `discard`. */
  begin(action: TransformAction): TransformEdit;

  /**
   * Sizes the selection to its content along `axes`, as double-clicking a resize handle does.
   *
   * @remarks
   * Targets whose size can follow their content (text boxes) implement this;
   * the transform box ignores the double-click for the others.
   */
  fitToContent?(axes: readonly SizeAxis[]): void;

  /**
   * True when the selection can only move: the transform box then shows no
   * resize or rotate handles. Absent means it can also be resized and turned.
   */
  readonly moveOnly?: boolean;
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
