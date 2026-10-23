import { Bounds } from "@shift/geo";
import type { NodeId, SelectableId } from "@shift/types";
import { isNodeId } from "@shift/types";
import type { Editor } from "../../editor/Editor";
import { localPoint } from "../../editor/spaces";
import type { AlignmentPositionGuide } from "../../../types/positionEdit";
import type { ShiftNode } from "../../../types/node";

/** Lines a box offers to snap to or from, in scene units: x positions and y positions. */
interface BoxLines {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** The box's scene extent, which a guide spans to. */
  readonly bounds: Bounds;
}

/** A snapped move: the corrected scene delta and the guides that show why. */
export interface BoxSnapResult {
  readonly delta: { readonly x: number; readonly y: number };
  readonly guides: readonly AlignmentPositionGuide[];
}

/**
 * Snaps moving boxes (text boxes and frames on a page) to other boxes on screen.
 *
 * @remarks
 * Works in scene units. Each box offers its left, centre, and right edges,
 * its top, middle, and bottom, and a text box also each line's baseline.
 * Targets and the moving lines are read once, when the drag starts; each
 * frame then pulls the move, per axis, onto the nearest pair within the
 * radius. Guides run between the two boxes along the shared line, drawn by
 * the Select tool's snap lines in scene space.
 */
export class BoxSnap {
  readonly #moving: BoxLines;
  readonly #targets: readonly BoxLines[];
  readonly #radius: number;

  private constructor(moving: BoxLines, targets: readonly BoxLines[], radius: number) {
    this.#moving = moving;
    this.#targets = targets;
    this.#radius = radius;
  }

  /**
   * Snapping for a selection of boxes, or null when the selection is not
   * boxes on a page or nothing on screen can be snapped to.
   */
  static forSelection(editor: Editor, ids: readonly SelectableId[]): BoxSnap | null {
    const scene = editor.scene;
    const moving = ids
      .filter(isNodeId)
      .map((id) => scene.node(id))
      .filter((node): node is ShiftNode => isBox(node) && scene.parent(node.id)?.kind === "page");
    if (moving.length === 0 || moving.length !== ids.length) return null;

    const lines = unionLines(moving.map((node) => boxLines(editor, node)));
    if (!lines) return null;

    const page = scene.activePage();
    const view = visibleScene(editor);
    const exclude = new Set<NodeId>(moving.map((node) => node.id));
    const targets: BoxLines[] = [];
    for (const node of page ? scene.descendants(page.id) : []) {
      if (!isBox(node) || exclude.has(node.id) || movesWith(scene, node, exclude)) continue;
      const target = boxLines(editor, node);
      if (target && (!view || Bounds.overlaps(target.bounds, view))) targets.push(target);
    }
    if (targets.length === 0) return null;

    return new BoxSnap(lines, targets, editor.hitRadius);
  }

  /** Pulls a scene delta onto the nearest lines within the radius, per axis. */
  snap(delta: { readonly x: number; readonly y: number }): BoxSnapResult {
    const x = this.#nearest(delta.x, "x");
    const y = this.#nearest(delta.y, "y");
    const snapped = { x: delta.x + (x?.offset ?? 0), y: delta.y + (y?.offset ?? 0) };
    const moved = Bounds.fromXYWH(
      this.#moving.bounds.min.x + snapped.x,
      this.#moving.bounds.min.y + snapped.y,
      Bounds.width(this.#moving.bounds),
      Bounds.height(this.#moving.bounds),
    );

    const guides: AlignmentPositionGuide[] = [];
    if (x) {
      const top = Math.min(moved.min.y, x.target.bounds.min.y);
      const bottom = Math.max(moved.max.y, x.target.bounds.max.y);
      guides.push({
        kind: "alignment",
        target: { x: x.line, y: top },
        point: { x: x.line, y: bottom },
      });
    }
    if (y) {
      const left = Math.min(moved.min.x, y.target.bounds.min.x);
      const right = Math.max(moved.max.x, y.target.bounds.max.x);
      guides.push({
        kind: "alignment",
        target: { x: left, y: y.line },
        point: { x: right, y: y.line },
      });
    }
    return { delta: snapped, guides };
  }

  #nearest(
    delta: number,
    axis: "x" | "y",
  ): { offset: number; line: number; target: BoxLines } | null {
    const own = axis === "x" ? this.#moving.xs : this.#moving.ys;
    let best: { offset: number; line: number; target: BoxLines } | null = null;
    for (const target of this.#targets) {
      for (const line of axis === "x" ? target.xs : target.ys) {
        for (const from of own) {
          const offset = line - (from + delta);
          if (Math.abs(offset) > this.#radius) continue;
          if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { offset, line, target };
        }
      }
    }
    return best;
  }
}

/** The part of the scene on screen, or null before the canvas has a size. */
function visibleScene(editor: Editor): Bounds | null {
  const camera = editor.camera;
  if (camera.logicalWidth <= 0 || camera.logicalHeight <= 0) return null;

  const visible = camera.visibleSceneBounds(0);
  return Bounds.create({ x: visible.minX, y: visible.minY }, { x: visible.maxX, y: visible.maxY });
}

function isBox(node: ShiftNode | null): node is ShiftNode {
  return node?.kind === "textRun" || node?.kind === "frame";
}

/** Whether `node` sits inside a box that is moving, so it moves too. */
function movesWith(scene: Editor["scene"], node: ShiftNode, moving: ReadonlySet<NodeId>): boolean {
  for (const ancestor of scene.ancestors(node.id)) {
    if (moving.has(ancestor.id)) return true;
  }
  return false;
}

/** A box's edges, centre, middle, and (for unturned text) baselines, in scene units. */
function boxLines(editor: Editor, node: ShiftNode): BoxLines | null {
  const bounds = editor.nodeBounds(node);
  if (!bounds) return null;

  const xs = [bounds.min.x, (bounds.min.x + bounds.max.x) / 2, bounds.max.x];
  const ys = [bounds.min.y, (bounds.min.y + bounds.max.y) / 2, bounds.max.y];
  if (node.kind === "textRun" && node.rotation === 0) {
    const layout = editor.text.boxLayoutCell(node).peek();
    for (const line of layout?.lines ?? []) {
      ys.push(editor.toScene(node, localPoint(0, line.y)).y);
    }
  }
  return { xs, ys, bounds };
}

/** One set of lines for several moving boxes: the union's edges and centre, and every baseline. */
function unionLines(boxes: readonly (BoxLines | null)[]): BoxLines | null {
  const present = boxes.filter((box): box is BoxLines => box !== null);
  const bounds = Bounds.unionAll(present.map((box) => box.bounds));
  if (!bounds) return null;
  if (present.length === 1) return present[0]!;

  return {
    xs: [bounds.min.x, (bounds.min.x + bounds.max.x) / 2, bounds.max.x],
    ys: [bounds.min.y, (bounds.min.y + bounds.max.y) / 2, bounds.max.y],
    bounds,
  };
}
