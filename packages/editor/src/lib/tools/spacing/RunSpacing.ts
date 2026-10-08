import type { Editor } from "../../editor/Editor";
import type { GlyphLayer } from "../../model/Glyph";
import type { ScenePoint } from "../../../types/coordinates";
import {
  sidebearingOfHalf,
  spacingGapCenter,
  type Sidebearing,
  type SpacingGap,
  type SpacingSide,
  type SpacingSideName,
} from "../../../types/spacing";

/**
 * One half of a spacing gap: the left glyph's right sidebearing (`left`) or
 * the right glyph's left sidebearing (`right`).
 *
 * @remarks
 * A measurement, not a live view: after an edit, get a fresh one with
 * {@link RunSpacing.refresh}.
 */
export class SpacingHalf {
  constructor(
    readonly gap: SpacingGap,
    readonly side: SpacingSideName,
  ) {}

  /** The glyph whose sidebearing this half is, or null at a line end. */
  get glyphSide(): SpacingSide | null {
    return this.gap[this.side];
  }

  /** Which of that glyph's sidebearings this half is. */
  get sidebearing(): Sidebearing {
    return sidebearingOfHalf(this.side);
  }

  /** The gap's other half, when it has one. */
  other(): SpacingHalf | null {
    const side = this.side === "left" ? "right" : "left";
    return this.gap[side] ? new SpacingHalf(this.gap, side) : null;
  }

  /** Whether both halves belong to the same gap, by its two glyphs. */
  sameGapAs(other: SpacingHalf): boolean {
    return (
      this.gap.node.id === other.gap.node.id &&
      this.gap.left?.itemId === other.gap.left?.itemId &&
      this.gap.right?.itemId === other.gap.right?.itemId
    );
  }

  /** Whether both are the same half measured to the same values. */
  equals(other: SpacingHalf | null): boolean {
    if (!other) return false;
    return (
      this.side === other.side &&
      this.sameGapAs(other) &&
      this.gap.leftBoundary === other.gap.leftBoundary &&
      this.gap.rightBoundary === other.gap.rightBoundary &&
      this.gap.left?.sidebearing === other.gap.left?.sidebearing &&
      this.gap.right?.sidebearing === other.gap.right?.sidebearing
    );
  }

  /** The glyph's editable layer at the active source, or null when it cannot be edited there. */
  layer(editor: Editor): GlyphLayer | null {
    const glyphSide = this.glyphSide;
    const sourceId = editor.activeSourceId;
    if (!glyphSide || !sourceId || editor.sessionMode !== "workspace") return null;
    return editor.glyphForId(glyphSide.glyphId)?.layerForSource(sourceId) ?? null;
  }

  /** The glyph's other sidebearing at the active source, or null without an outline. */
  oppositeSidebearing(layer: GlyphLayer): number | null {
    const { lsb, rsb } = layer.sidebearings;
    return this.sidebearing === "rsb" ? lsb : rsb;
  }

  /**
   * Sets this sidebearing at the active source, as one undo step.
   *
   * @remarks
   * An unchanged value is ignored: a no-op edit would break the next undo (#524).
   *
   * @param value - The new sidebearing in units; rounded.
   * @returns false when nothing changed or the glyph cannot be edited here.
   */
  set(editor: Editor, value: number): boolean {
    const glyphSide = this.glyphSide;
    const layer = this.layer(editor);
    const rounded = Math.round(value);
    if (!glyphSide || !layer || rounded === Math.round(glyphSide.sidebearing)) return false;

    if (this.sidebearing === "rsb") layer.setRightSidebearing(rounded);
    else layer.setLeftSidebearing(rounded);
    return true;
  }

  /**
   * Makes this half's glyph the run's current glyph, so the glyph sidebar shows it.
   *
   * @remarks
   * Writes scene records, so call it inside a history capture.
   */
  select(editor: Editor): this {
    const itemId = this.glyphSide?.itemId;
    if (itemId) editor.nodeDefinition("textRun").editItem(this.gap.node, itemId);
    return this;
  }
}

/** The spacing gaps of the editor's text runs, measured on demand. */
export class RunSpacing {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /**
   * Returns the half under a scene point in the topmost run that has a gap there.
   *
   * @remarks
   * Each half spans its outline edge and the boundary, in either order, so a
   * negative sidebearing's half lies past the boundary. The half containing
   * the point wins; where both do, the negative one, which is reachable only
   * there; where neither does, left of the boundary is the left half. A gap
   * with only one side always gives that side.
   */
  halfAt(point: ScenePoint): SpacingHalf | null {
    const definition = this.#editor.nodeDefinition("textRun");
    const runs = this.#editor.scene.nodesOfKind("textRun");
    for (let index = runs.length - 1; index >= 0; index--) {
      const node = runs[index]!;
      const local = this.#editor.toLocal(node, point);
      const gap = definition.spacingGapAt(node, local);
      if (gap) return new SpacingHalf(gap, sideAt(gap, local.x));
    }
    return null;
  }

  /** Measures a half again after an edit, by its gap's two glyphs; unchanged if they are no longer neighbours. */
  refresh(half: SpacingHalf): SpacingHalf {
    const { node, left, right } = half.gap;
    const gap = this.#editor
      .nodeDefinition("textRun")
      .spacingGapBetween(node, left?.itemId ?? null, right?.itemId ?? null);
    return gap ? new SpacingHalf(gap, half.side) : half;
  }

  /**
   * Returns the half before or after `half` in reading order: a gap's left
   * half, its right half, then the next gap's.
   *
   * @returns null at either end of the run.
   */
  adjacent(half: SpacingHalf, step: -1 | 1): SpacingHalf | null {
    const halves = this.#halves(half.gap.node);
    const index = halves.findIndex(
      (candidate) => candidate.side === half.side && candidate.sameGapAs(half),
    );
    return index === -1 ? null : (halves[index + step] ?? null);
  }

  /**
   * Returns the half holding the same glyph's other sidebearing: for a right
   * sidebearing, the gap before that glyph; for a left one, the gap after it.
   */
  oppositeHalf(half: SpacingHalf): SpacingHalf | null {
    const itemId = half.glyphSide?.itemId;
    if (!itemId) return null;
    const side = half.side === "left" ? "right" : "left";
    return (
      this.#halves(half.gap.node).find(
        (candidate) => candidate.side === side && candidate.glyphSide?.itemId === itemId,
      ) ?? null
    );
  }

  #halves(node: SpacingGap["node"]): SpacingHalf[] {
    const halves: SpacingHalf[] = [];
    for (const gap of this.#editor.nodeDefinition("textRun").spacingGaps(node)) {
      if (gap.left) halves.push(new SpacingHalf(gap, "left"));
      if (gap.right) halves.push(new SpacingHalf(gap, "right"));
    }
    return halves;
  }
}

function sideAt(gap: SpacingGap, x: number): SpacingSideName {
  const inLeft = gap.left !== null && between(x, gap.left.edge, gap.leftBoundary);
  const inRight = gap.right !== null && between(x, gap.rightBoundary, gap.right.edge);
  if (inLeft !== inRight) return inLeft ? "left" : "right";
  if (inLeft && gap.left!.sidebearing < 0) return "left";
  if (inRight && gap.right!.sidebearing < 0) return "right";

  const pointerSide = x < spacingGapCenter(gap) ? "left" : "right";
  if (gap[pointerSide]) return pointerSide;
  return gap.left ? "left" : "right";
}

function between(x: number, a: number, b: number): boolean {
  return x >= Math.min(a, b) && x <= Math.max(a, b);
}
