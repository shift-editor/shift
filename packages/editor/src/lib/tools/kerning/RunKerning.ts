import type { GlyphId, SourceId } from "@shift/types";
import type { Editor } from "../../editor/Editor";
import {
  isGroupSide,
  kerningValueEdit,
  type KerningPairPosition,
  type ResolvedKerning,
} from "../../model/Kerning";
import type { ScenePoint } from "../../../types/coordinates";
import { spacingGapCenter, type SpacingGap, type SpacingSide } from "../../../types/spacing";

/** A spacing gap with a glyph on both sides. */
type KernedGap = SpacingGap & { readonly left: SpacingSide; readonly right: SpacingSide };

/**
 * The kern between two neighbouring glyphs of a run.
 *
 * @remarks
 * A measurement, not a live view: after an edit, get a fresh one with
 * {@link RunKerning.refresh}. The displayed kern is the distance between the
 * gap's two advance boundaries.
 */
export class KerningPair {
  constructor(readonly gap: KernedGap) {}

  get first(): GlyphId {
    return this.gap.left.glyphId;
  }

  get second(): GlyphId {
    return this.gap.right.glyphId;
  }

  /** The kern shown between the glyphs at the displayed location, in units. */
  get amount(): number {
    return this.gap.rightBoundary - this.gap.leftBoundary;
  }

  /** X of the middle of the kern, in the run's units. */
  get center(): number {
    return spacingGapCenter(this.gap);
  }

  /** Whether both measure the same two text items. */
  sameAs(other: KerningPair | null): boolean {
    return (
      other !== null &&
      this.gap.node.id === other.gap.node.id &&
      this.gap.left.itemId === other.gap.left.itemId &&
      this.gap.right.itemId === other.gap.right.itemId
    );
  }

  /** Whether both are the same pair measured to the same kern. */
  equals(other: KerningPair | null): boolean {
    return other !== null && this.sameAs(other) && this.amount === other.amount;
  }

  /** The source kerning edits apply to, or null where kerning cannot be edited. */
  source(editor: Editor): SourceId | null {
    return editor.sessionMode === "workspace" ? editor.activeSourceId : null;
  }

  /**
   * The authored pair an edit changes at a source, with its value there.
   *
   * @param sourceId - The source to edit; the active source when omitted.
   * @returns null where kerning cannot be edited.
   */
  editablePair(editor: Editor, sourceId = this.source(editor)): ResolvedKerning | null {
    if (!sourceId || editor.sessionMode !== "workspace") return null;
    return editor.font.kerningCell.peek().editablePair(sourceId, this.first, this.second);
  }

  /**
   * Sets the pair's value at a source, as one undo step.
   *
   * @param amount - The new kern in units; rounded, and ignored when unchanged.
   * @param sourceId - The source to edit; the active source when omitted.
   * @returns false when nothing changed or kerning cannot be edited there.
   */
  set(editor: Editor, amount: number, sourceId = this.source(editor)): boolean {
    const pair = this.editablePair(editor, sourceId);
    const rounded = Math.round(amount);
    if (!sourceId || !pair || rounded === pair.amount) return false;

    void editor.font.setKerningValues(
      [kerningValueEdit(sourceId, pair, rounded)],
      "Change kerning",
    );
    return true;
  }

  /** Shows `amount` for the pair without committing it, or clears the preview with null. */
  preview(editor: Editor, amount: number | null): void {
    const sourceId = this.source(editor);
    const pair = this.editablePair(editor);
    if (amount === null || !sourceId || !pair) {
      editor.font.previewKerning([]);
      return;
    }
    editor.font.previewKerning([kerningValueEdit(sourceId, pair, Math.round(amount))]);
  }

  /**
   * Whether a side of the edited pair is the glyph itself rather than its
   * group, and whether that can be toggled.
   */
  lock(editor: Editor, position: KerningPairPosition): KerningLock {
    const glyphId = position === "first" ? this.first : this.second;
    const pair = this.editablePair(editor);
    const grouped = editor.font.kerningCell.peek().groupOf(position, glyphId) !== null;
    const side = pair ? pair[position] : null;
    return {
      locked: !grouped || (side !== null && !isGroupSide(side)),
      toggleable: grouped && pair !== null,
    };
  }

  /**
   * Makes a side a glyph exception or returns it to its group, at the active
   * source, as one undo step. The kern does not move.
   *
   * @returns false when the side cannot be toggled here.
   */
  toggleLock(editor: Editor, position: KerningPairPosition): boolean {
    const sourceId = this.source(editor);
    const pair = this.editablePair(editor);
    if (!sourceId || !pair) return false;

    const exception = isGroupSide(pair[position]);
    const edit = editor.font.kerningCell
      .peek()
      .exceptionEdit(sourceId, this.first, this.second, pair, position, exception);
    if (!edit) return false;
    void editor.font.setKerningValues(
      [edit],
      exception ? "Make kerning exception" : "Remove kerning exception",
    );
    return true;
  }
}

/** One side's lock: locked kerns the glyph itself, unlocked kerns its group. */
export interface KerningLock {
  readonly locked: boolean;
  /** False for a glyph without a group on that side, which can only kern as itself. */
  readonly toggleable: boolean;
}

/** The kerned pairs of the editor's text runs, measured on demand. */
export class RunKerning {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Returns the pair whose gap is under a scene point in the topmost run that has one. */
  pairAt(point: ScenePoint): KerningPair | null {
    const definition = this.#editor.nodeDefinition("textRun");
    const runs = this.#editor.scene.nodesOfKind("textRun");
    for (let index = runs.length - 1; index >= 0; index--) {
      const node = runs[index]!;
      const gap = definition.spacingGapAt(node, this.#editor.toLocal(node, point));
      if (gap) return kernedPair(gap);
    }
    return null;
  }

  /** Measures a pair again after an edit; unchanged if its glyphs are no longer neighbours. */
  refresh(pair: KerningPair): KerningPair {
    const { node, left, right } = pair.gap;
    const gap = this.#editor
      .nodeDefinition("textRun")
      .spacingGapBetween(node, left.itemId, right.itemId);
    return (gap && kernedPair(gap)) ?? pair;
  }

  /**
   * Returns the pair before or after `pair` in reading order.
   *
   * @returns null at either end of the run.
   */
  adjacent(pair: KerningPair, step: -1 | 1): KerningPair | null {
    const pairs = this.#editor
      .nodeDefinition("textRun")
      .spacingGaps(pair.gap.node)
      .flatMap((gap) => kernedPair(gap) ?? []);
    const index = pairs.findIndex((candidate) => candidate.sameAs(pair));
    return index === -1 ? null : (pairs[index + step] ?? null);
  }
}

function kernedPair(gap: SpacingGap): KerningPair | null {
  const { left, right } = gap;
  if (!left || !right) return null;
  return new KerningPair({ ...gap, left, right });
}
