import type { Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type {
  LayoutNodeInput,
  LayoutSizing,
  LayoutTextInput,
} from "../wasm/generated/shapingLayouts";
import type { SceneStructure } from "../editor/Scene";
import type {
  FrameLayout,
  LaidOutNode,
  LayoutPageFunction,
  PageLayout,
  Sizing,
} from "../../types/frame";

/** A frame with nothing laid out. */
export const EMPTY_PAGE_LAYOUT: PageLayout = new Map();

const HUG: LayoutSizing = { mode: "hug", size: 0 };
const FILL: LayoutSizing = { mode: "fill", size: 0 };

/** What layout reads from a frame: everything but its position. */
export interface FrameShape {
  readonly kind: "frame";
  readonly layout: FrameLayout;
  readonly width: Sizing;
  readonly height: Sizing;
}

/**
 * What layout reads from a text box, in scene units.
 *
 * @remarks
 * A box that hugs or has a fixed width is a leaf of its measured size; a box
 * that fills its frame passes its break segments, so the engine picks its
 * width and breaks its lines. A box's origin is its top-left corner, so the
 * box layout places is where the node goes.
 */
export type RunMeasure =
  | {
      readonly kind: "textRun";
      readonly fill: false;
      readonly size: { readonly width: number; readonly height: number };
    }
  | { readonly kind: "textRun"; readonly fill: true; readonly text: LayoutTextInput };

/** What layout reads from one node; null for a node layout skips. */
export type LayoutShape = FrameShape | RunMeasure | null;

/** One layout input node and how to find its origin from its box. */
interface Entry {
  readonly id: NodeId;
  /** The node's origin relative to its box's top-left corner. */
  readonly offset: Point2D;
}

/**
 * Lays out one top-level frame and everything in it, in one call to the layout engine.
 *
 * @remarks
 * The frame is laid out at its own origin: where it sits on the page is a
 * transform, not layout, so moving it never lays it out again. Frames become
 * layout frames and text runs fixed-size leaves (a run never wraps here);
 * other nodes are skipped. Reactive through `shape`: called from a computed,
 * it reruns only when the structure under the frame or a shape it read changes.
 *
 * @param structure - the scene's structure.
 * @param rootId - the top-level frame.
 * @param shape - what layout reads from a node, from its cached cell.
 * @param layoutPage - the engine, from the shaping module.
 * @returns each laid-out node's box and origin, relative to its parent; empty when `rootId` is not a frame.
 */
export function layOutFrame(
  structure: SceneStructure,
  rootId: NodeId,
  shape: (nodeId: NodeId) => LayoutShape,
  layoutPage: LayoutPageFunction,
): PageLayout {
  const root = shape(rootId);
  if (root?.kind !== "frame") return EMPTY_PAGE_LAYOUT;

  const nodes: LayoutNodeInput[] = [layoutNode("page", null)];
  const entries: Entry[] = [];

  const addFrame = (id: NodeId, frame: FrameShape, parent: number): void => {
    const index = nodes.length;
    nodes.push({
      ...layoutNode("frame", parent),
      width: sizingInput(frame.width),
      height: sizingInput(frame.height),
      frame: { ...frame.layout, wrap: false },
    });
    entries.push({ id, offset: { x: 0, y: 0 } });

    for (const childId of structure.children(id)) {
      const child = shape(childId);
      switch (child?.kind) {
        case "frame":
          addFrame(childId, child, index);
          break;
        case "textRun":
          nodes.push(
            child.fill
              ? { ...layoutNode("text", index), width: FILL, text: child.text }
              : { ...layoutNode("fixed", index), intrinsic: child.size },
          );
          entries.push({ id: childId, offset: { x: 0, y: 0 } });
          break;
        case undefined:
          break;
      }
    }
  };
  addFrame(rootId, root, 0);

  const output = layoutPage({ nodes });
  if (!output) return EMPTY_PAGE_LAYOUT;

  const layout = new Map<NodeId, LaidOutNode>();
  entries.forEach((entry, index) => {
    const box = output.boxes[index + 1];
    if (!box) return;

    layout.set(entry.id, {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      origin: { x: box.x + entry.offset.x, y: box.y + entry.offset.y },
    });
  });
  return layout;
}

function layoutNode(kind: LayoutNodeInput["kind"], parent: number | null): LayoutNodeInput {
  return { kind, parent, width: HUG, height: HUG, placement: "auto", x: 0, y: 0 };
}

function sizingInput(sizing: Sizing): LayoutSizing {
  switch (sizing.kind) {
    case "fixed":
      return { mode: "fixed", size: sizing.size };
    case "hug":
      return HUG;
    case "fill":
      return { mode: "fill", size: 0 };
  }
}

/** Whether two shapes lay out the same. */
export function sameShape(a: LayoutShape, b: LayoutShape): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  switch (a.kind) {
    case "frame":
      return (
        b.kind === "frame" &&
        a.layout === b.layout &&
        sameSizing(a.width, b.width) &&
        sameSizing(a.height, b.height)
      );
    case "textRun":
      if (b.kind !== "textRun") return false;
      if (a.fill || b.fill) return a.fill && b.fill && sameText(a.text, b.text);
      return a.size.width === b.size.width && a.size.height === b.size.height;
  }
}

export function sameSizing(a: Sizing, b: Sizing): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "fixed" || (b.kind === "fixed" && a.size === b.size);
}

function sameText(a: LayoutTextInput, b: LayoutTextInput): boolean {
  return (
    a.lineHeight === b.lineHeight &&
    a.scale === b.scale &&
    sameNumbers(a.widths, b.widths) &&
    sameNumbers(a.trailing, b.trailing) &&
    sameNumbers(a.hardBreaks, b.hardBreaks)
  );
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
