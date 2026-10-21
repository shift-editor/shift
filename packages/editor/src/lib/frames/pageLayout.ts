import type { Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { Editor } from "../editor/Editor";
import type { Tree } from "../utils/Tree";
import { track } from "../signals";
import type { LayoutNodeInput, LayoutSizing } from "../wasm/generated/shapingLayouts";
import type { FrameNode, ShiftNode, TextRunNode } from "../../types/node";
import type { LaidOutNode, LayoutPageFunction, PageLayout, Sizing } from "../../types/frame";

/** A page with nothing laid out. */
export const EMPTY_PAGE_LAYOUT: PageLayout = new Map();

const HUG: LayoutSizing = { mode: "hug", size: 0 };

/** One layout input node and how to find its origin from its box. */
interface Entry {
  readonly id: NodeId;
  /** The node's origin relative to its box's top-left corner. */
  readonly offset: Point2D;
}

/**
 * Lays out the frames on one page in one call to the layout engine.
 *
 * @remarks
 * Walks the page's frames and their subtrees: frames become layout frames
 * and text runs become fixed-size leaves measured from their current text
 * layout (so a run never wraps here). Glyph nodes inside runs, and nodes
 * outside frames, are not laid out. Reactive: called from a computed, it
 * tracks every run layout it measures and the font's units per em.
 *
 * @param tree - the scene's node tree.
 * @param pageId - the page to lay out.
 * @param layoutPage - the engine, from the shaping module.
 * @returns each laid-out node's box and origin; empty when the page has no frame.
 */
export function layOutPage(
  editor: Editor,
  tree: Tree<NodeId, ShiftNode>,
  pageId: NodeId,
  layoutPage: LayoutPageFunction,
): PageLayout {
  const nodes: LayoutNodeInput[] = [layoutNode("page", null)];
  const entries: Entry[] = [];
  track(editor.font.metricsCell);
  const unitsPerEm = editor.font.metricsCell.peek().unitsPerEm;

  const addRun = (run: TextRunNode, parent: number): void => {
    const { size, offset } = measureRun(editor, run, unitsPerEm);
    nodes.push({ ...layoutNode("fixed", parent), intrinsic: size });
    entries.push({ id: run.id, offset });
  };

  const addFrame = (frame: FrameNode, parent: number): void => {
    const index = nodes.length;
    nodes.push({
      ...layoutNode("frame", parent),
      width: sizingInput(frame.width),
      height: sizingInput(frame.height),
      x: frame.position.x,
      y: frame.position.y,
      frame: { ...frame.layout, wrap: false },
    });
    entries.push({ id: frame.id, offset: { x: 0, y: 0 } });

    for (const child of tree.children(frame.id)) {
      switch (child.kind) {
        case "frame":
          addFrame(child, index);
          break;
        case "textRun":
          addRun(child, index);
          break;
        case "glyph":
        case "page":
          break;
      }
    }
  };

  for (const child of tree.children(pageId)) {
    if (child.kind === "frame") addFrame(child, 0);
  }
  if (entries.length === 0) return EMPTY_PAGE_LAYOUT;

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

/**
 * Measures a text run as a fixed leaf: its drawn box in scene units, and its
 * origin (the first baseline's start) from the box's top-left corner.
 */
function measureRun(
  editor: Editor,
  run: TextRunNode,
  unitsPerEm: number,
): { size: { width: number; height: number }; offset: Point2D } {
  track(editor.text.layoutCell(run.runId));
  const bounds = editor.nodeDefinition("textRun").bounds(run);
  if (!bounds) return { size: { width: 0, height: 0 }, offset: { x: 0, y: 0 } };

  const scale = run.size / unitsPerEm;
  return {
    size: {
      width: (bounds.max.x - bounds.min.x) * scale,
      height: (bounds.max.y - bounds.min.y) * scale,
    },
    // The run draws Y-up from its baseline, so its box top is `max.y` above the origin.
    offset: { x: -bounds.min.x * scale, y: bounds.max.y * scale },
  };
}
