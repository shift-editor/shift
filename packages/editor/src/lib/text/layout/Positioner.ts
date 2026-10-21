import type { Point2D } from "@shift/geo";
import type { GlyphId, GlyphName, ShapedGlyph, Source, Unicode } from "@shift/types";
import { track } from "../../signals";
import { displayAdvance } from "../../utils/displayAdvance";
import type { PositionedGlyph, PositionedRun, SegmentedRun } from "./types";
import type { Editor } from "../../editor/Editor";
import type { GlyphRenderModel } from "../../model/Glyph";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";

/**
 * How marks are placed: `"anchors"` attaches each mark to the glyph before it
 * through matching anchors, as shaped text does; `"literal"` sets each
 * non-spacing glyph beside the text, for unshaped side-by-side editing.
 */
export type MarkPlacement = "anchors" | "literal";

/** One glyph of a run with the data positioning reads from it. */
interface RunGlyph {
  readonly shaped: ShapedGlyph;
  readonly glyphId: GlyphId | null;
  readonly name: GlyphName;
  readonly model: GlyphRenderModel | null;
}

/**
 * Where a mark goes: `offset` from the anchor of the glyph at index `to`, or a
 * fixed `offset` from its own place when `to` is null.
 */
interface MarkOffset {
  readonly to: number | null;
  readonly offset: Point2D;
}

const NOTDEF = ".notdef" as GlyphName;

/**
 * Positions a run's glyphs with live glyph data.
 *
 * @remarks
 * The shaper substitutes glyphs and applies the feature code's own
 * positioning; this adds what export generates from structured data: each
 * glyph's current advance, pair kerning between neighbours in a left-to-right
 * run, and mark placement.
 *
 * Two facts make a glyph a mark, and they decide different things. The
 * shaper's `isMark` (the compiled font's `GDEF` mark class, which export
 * gives only category-Mark glyphs) decides that a glyph attaches by anchors
 * and is passed over: it is not kerned and does not break a kerning pair.
 * The category export resolves (`Font.isNonspacingMark`) decides its
 * advance: such a mark takes none in shaped text, as export compiles it,
 * while a spacing mark keeps its width. Outside shaped text a nonspacing
 * mark at zero gets a visible stand-in advance, and a character with no
 * glyph counts as spacing. Made for one layout, which tracks every glyph it reads; glyph lookups are
 * cached for that layout.
 */
export class Positioner {
  readonly #editor: Editor;
  readonly #externalLocation: Signal<ExternalAxisLocation>;
  // non-reactive: lookups for one layout computation, which tracks each model on first read
  readonly #models = new Map<GlyphId, GlyphRenderModel | null>();

  constructor(editor: Editor, externalLocation: Signal<ExternalAxisLocation>) {
    this.#editor = editor;
    this.#externalLocation = externalLocation;
  }

  position(run: SegmentedRun, marks: MarkPlacement): PositionedRun {
    // Called from the run's layout computed, which tracks location and active source.
    track(this.#editor.font.kerningCell);
    const glyphs = run.shaped.map((shaped) => this.#runGlyph(run, shaped));
    const markOffsets =
      marks === "anchors" ? this.#anchorOffsets(run, glyphs) : this.#literalOffsets(glyphs);

    const positioned: PositionedGlyph[] = [];
    let pen = 0;
    let kernable: PositionedGlyph | null = null;
    for (const [index, glyph] of glyphs.entries()) {
      const mark = markOffsets.get(index);
      const attached = mark !== undefined && mark.to !== null;
      // A mark the font classes as one is passed over: never kerned, and it keeps the pair around it.
      const passedOver = glyph.shaped.isMark;
      const spacing = !mark && !passedOver;
      if (spacing && kernable?.glyphId && glyph.glyphId && run.direction === "ltr") {
        kernable.xKern = this.#editor.font.kerningBetween(
          kernable.glyphId,
          glyph.glyphId,
          this.#externalLocation.peek(),
          this.#editor.activeSourceIdCell.peek(),
        );
        pen += kernable.xKern;
      }

      const ownOffset = mark && !attached ? mark.offset : { x: 0, y: 0 };
      const xAdvance = this.#advance(glyph, passedOver);
      const current: PositionedGlyph = {
        glyphId: glyph.glyphId,
        glyphName: glyph.name,
        sourceItemIds: itemIds(run, glyph.shaped.cluster),
        origin: { x: pen, y: 0 },
        xAdvance,
        xKern: 0,
        yAdvance: glyph.shaped.yAdvance,
        xOffset: glyph.shaped.xOffset + ownOffset.x,
        yOffset: glyph.shaped.yOffset + ownOffset.y,
        cluster: run.clusterStart + glyph.shaped.cluster,
        bounds: glyph.model?.bounds ?? null,
      };
      positioned.push(current);
      pen += xAdvance;
      if (passedOver) continue;
      // A literal mark breaks the kerning pair around it.
      kernable = mark ? null : current;
    }

    // In logical order, so a mark on a mark follows its target's final place.
    for (const index of logicalIndexes(run)) {
      const mark = markOffsets.get(index);
      const current = positioned[index];
      const target = mark?.to == null ? undefined : positioned[mark.to];
      if (!mark || !current || !target) continue;
      current.origin = { ...target.origin };
      current.xOffset += target.xOffset + mark.offset.x;
      current.yOffset += target.yOffset + mark.offset.y;
    }

    return { ...run, glyphs: positioned, advance: pen };
  }

  #runGlyph(run: SegmentedRun, shaped: ShapedGlyph): RunGlyph {
    const font = this.#editor.font;
    const item = run.items[shaped.cluster];
    // The shaper answers .notdef, and a pick its compiled font lacks, with no glyph; a pick
    // the font has still shows itself.
    const glyphId = shaped.glyphId ?? (item?.kind === "glyph" ? item.glyphId : null);
    const entry = glyphId ? font.entryForId(glyphId) : null;
    if (entry) {
      return {
        shaped,
        glyphId: entry.id,
        name: entry.name,
        model: this.#model(entry.id),
      };
    }
    // No glyph: a character the font lacks keeps the name it would take; a missing pick is .notdef.
    const codepoint = item?.kind === "character" ? item.codepoint : null;
    return {
      shaped,
      glyphId: null,
      name: codepoint === null ? NOTDEF : font.nameForUnicode(codepoint as Unicode),
      model: null,
    };
  }

  /**
   * A glyph's advance: none for a nonspacing mark the shaper classes as a
   * mark, as export compiles it; a spacing mark keeps its width; any other
   * glyph takes its display advance.
   */
  #advance(glyph: RunGlyph, passedOver: boolean): number {
    const nonspacing = this.#editor.font.isNonspacingMark(glyph.name);
    const own = glyph.model?.xAdvance ?? 0;
    if (passedOver) return nonspacing ? 0 : own + glyph.shaped.xAdvance;
    return displayAdvance(own, nonspacing) + glyph.shaped.xAdvance;
  }

  /** The glyph's render model at the layout's location; null until the glyph loads. */
  #model(glyphId: GlyphId): GlyphRenderModel | null {
    const cached = this.#models.get(glyphId);
    if (cached !== undefined) return cached;
    const model =
      this.#editor
        .glyphForId(glyphId)
        ?.renderModelAt(this.#externalLocation, this.#editor.activeSourceIdCell) ?? null;
    // Inside the run's layout computed: spacing edits re-run the layout.
    if (model) track(model.xAdvanceCell);
    this.#models.set(glyphId, model);
    return model;
  }

  /**
   * Attaches each mark to the glyph before it in logical order: to a preceding
   * mark with the matching anchor (mark to mark), otherwise to the base.
   *
   * @remarks
   * Only a glyph the shaper flags as a mark attaches, as in the exported font,
   * which gives only category-Mark glyphs the `GDEF` mark class. An `_name`
   * anchor alone does not make one: a spacing dieresis inherits `_top` from
   * its combining component but still sits beside the letter.
   */
  #anchorOffsets(run: SegmentedRun, glyphs: readonly RunGlyph[]): Map<number, MarkOffset> {
    const offsets = new Map<number, MarkOffset>();
    let base: number | null = null;
    let previousMark: number | null = null;
    for (const index of logicalIndexes(run)) {
      const glyph = glyphs[index];
      const model = glyph?.shaped.isMark ? glyph.model : null;
      const offset = anchorOffset(model, previousMark, glyphs) ?? anchorOffset(model, base, glyphs);
      if (offset) {
        offsets.set(index, offset);
        previousMark = index;
        continue;
      }
      base = index;
      previousMark = null;
    }
    return offsets;
  }

  /** Sets each non-spacing glyph beside the text, on the anchor height it attaches at. */
  #literalOffsets(glyphs: readonly RunGlyph[]): Map<number, MarkOffset> {
    const source =
      this.#editor.activeSource ??
      this.#editor.font.sourceAtOrDefault(this.#externalLocation.peek());
    const offsets = new Map<number, MarkOffset>();
    for (const [index, glyph] of glyphs.entries()) {
      if (!this.#editor.font.isNonspacingMark(glyph.name)) continue;
      offsets.set(index, {
        to: null,
        offset: this.#literalMarkOffset(glyph, source),
      });
    }
    return offsets;
  }

  #literalMarkOffset(glyph: RunGlyph, source: Source | null): Point2D {
    const layer =
      glyph.glyphId && source
        ? (this.#editor.glyphForId(glyph.glyphId)?.layerForSource(source.id) ?? null)
        : null;
    if (!layer) return { x: 0, y: 0 };

    const metrics = this.#editor.font.defaultSourceMetrics;
    const targetX = 300;
    const targetYForAnchorName = (anchorName: string): number => {
      switch (anchorName) {
        case "top":
          return metrics.capHeight ?? metrics.ascender;
        case "bottom":
        case "ogonek":
          return 0;
        case "center":
        default:
          return (metrics.ascender + metrics.descender) / 2;
      }
    };

    const attachingAnchor = layer.anchors.find((anchor) => {
      const name = anchor.name ?? "";
      return name.startsWith("_") && name.length > 1;
    });
    if (attachingAnchor) {
      const targetName = attachingAnchor.name!.slice(1);
      return {
        x: targetX - attachingAnchor.x,
        y: targetYForAnchorName(targetName) - attachingAnchor.y,
      };
    }

    const bounds = layer.bounds;
    if (!bounds) return { x: 0, y: 0 };
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    return {
      x: targetX - centerX,
      y: (metrics.ascender + metrics.descender) / 2 - centerY,
    };
  }
}

/**
 * The offset that puts a mark's `_name` anchor on the target's `name` anchor; null when none match.
 *
 * @remarks
 * Reads both glyphs' anchors with their components' copied in, as export
 * compiles them, so a mark attaches to a composite's propagated anchors.
 */
function anchorOffset(
  mark: GlyphRenderModel | null,
  target: number | null,
  glyphs: readonly RunGlyph[],
): MarkOffset | null {
  const targetModel = target === null ? null : glyphs[target]?.model;
  if (!mark || target === null || !targetModel) return null;
  // Inside the run's layout computed: the layout reruns when an attaching
  // anchor, or the target anchor it attaches to, changes, and not for others.
  track(mark.attachingAnchorsCell);
  for (const markAnchor of mark.attachingAnchorsCell.peek()) {
    const targetAnchor = targetModel.anchorNamed(markAnchor.name.slice(1));
    if (targetAnchor) {
      return {
        to: target,
        offset: {
          x: targetAnchor.x - markAnchor.x,
          y: targetAnchor.y - markAnchor.y,
        },
      };
    }
  }
  return null;
}

/** Indexes into the run's visual-order glyphs, in logical order. */
function logicalIndexes(run: SegmentedRun): number[] {
  const indexes = run.shaped.map((_, index) => index);
  return run.direction === "rtl" ? indexes.reverse() : indexes;
}

/** Returns the items a glyph at `cluster` covers: up to the run's next cluster. */
function itemIds(run: SegmentedRun, cluster: number): PositionedGlyph["sourceItemIds"] {
  const next = run.shaped.reduce(
    (end, glyph) => (glyph.cluster > cluster && glyph.cluster < end ? glyph.cluster : end),
    run.items.length,
  );
  return run.items.slice(cluster, next).map((item) => item.id);
}
