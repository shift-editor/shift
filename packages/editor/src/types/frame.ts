import type { Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { LayoutPageInput, LayoutPageOutput } from "../lib/wasm/generated/shapingLayouts";

/** The axis a frame stacks its children along: across (`row`) or down (`column`). */
export type FrameMode = "row" | "column";

/** Where a frame's children sit across its stacking axis. */
export type FrameAlign = "start" | "center" | "end";

/** How a frame's children share its stacking axis. */
export type FrameJustify = "start" | "center" | "end" | "space-between";

/** Space inside a frame's edges, in scene units. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * One axis's size rule.
 *
 * @remarks
 * `fixed` keeps `size` scene units, `hug` fits the content, and `fill` takes
 * the room left in the parent frame. `fill` on a frame placed directly on a
 * page lays out as `hug`.
 */
export type Sizing =
  | { readonly kind: "fixed"; readonly size: number }
  | { readonly kind: "hug" }
  | { readonly kind: "fill" };

/** Which of a frame's sizes to read or set. */
export type FrameAxis = "width" | "height";

/** How a frame places its children. */
export interface FrameLayout {
  readonly mode: FrameMode;
  /** Space between neighbouring children, in scene units. */
  readonly gap: number;
  readonly padding: Insets;
  readonly align: FrameAlign;
  readonly justify: FrameJustify;
}

/**
 * Where the page layout put one node, in its parent's frame (Y-down, scene units).
 *
 * @remarks
 * `box` is what the node occupies; `origin` is where its own frame starts,
 * which differs from the box's corner for a text run (its origin is on the
 * first baseline).
 */
export interface LaidOutNode {
  readonly box: LayoutBox;
  readonly origin: Point2D;
}

/** A laid-out box: its top-left corner in the parent's frame and its size, in scene units. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Options for a new frame; omitted fields take the defaults (a hugging column, gap 16, padding 16). */
export interface FrameOptions {
  readonly name?: string;
  readonly layout?: Partial<FrameLayout>;
  readonly width?: Sizing;
  readonly height?: Sizing;
  /** Origin on the page; ignored inside another frame, which places it. */
  readonly position?: Point2D;
}

/**
 * Where the page layout put each node on the active page, by id.
 *
 * @remarks
 * Holds frames and the nodes they place; nodes outside frames are absent.
 */
export type PageLayout = ReadonlyMap<NodeId, LaidOutNode>;

/** The layout engine's entry point, `layoutPage` in the shaping module. */
export type LayoutPageFunction = (input: LayoutPageInput) => LayoutPageOutput | null;
