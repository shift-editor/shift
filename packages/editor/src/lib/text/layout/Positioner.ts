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
 * run, and mark placement. A glyph's advance follows the category export
 * resolves: a nonspacing mark (`Font.isNonspacingMark`) at zero gets a
 * visible stand-in advance, and a character with no glyph counts as spacing.
 * Made for one layout, which tracks every glyph it reads; glyph lookups are
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
    const kerns = this.#kerns(run, glyphs, markOffsets);

    const positioned: PositionedGlyph[] = [];
    let pen = 0;
    let kernable: PositionedGlyph | null = null;
    for (const [index, glyph] of glyphs.entries()) {
      const mark = markOffsets.get(index);
      const kern = kerns.get(index);
      if (kernable && kern !== undefined) {
        kernable.xKern = kern;
        pen += kern;
      }

      const attached = mark !== undefined && mark.to !== null;
      const ownOffset = mark && !attached ? mark.offset : { x: 0, y: 0 };
      const xAdvance = attached
        ? 0
        : displayAdvance(
            glyph.model?.xAdvance ?? 0,
            this.#editor.font.isNonspacingMark(glyph.name),
          ) + glyph.shaped.xAdvance;
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
      };
      positioned.push(current);
      if (attached) continue;
      pen += xAdvance;
      // A literal mark breaks the kerning pair around it; an attached one is skipped over.
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

  /**
   * The kern before each glyph that kerns with the glyph before it, by index,
   * read for the whole run in one engine call: in a left-to-right run, each
   * glyph and the last spacing glyph before it, skipping attached marks; a
   * literal mark breaks the pair around it.
   */
  #kerns(
    run: SegmentedRun,
    glyphs: readonly RunGlyph[],
    markOffsets: ReadonlyMap<number, MarkOffset>,
  ): Map<number, number> {
    const pairs: GlyphId[] = [];
    const kerned: number[] = [];
    if (run.direction === "ltr") {
      let kernable: GlyphId | null = null;
      for (const [index, glyph] of glyphs.entries()) {
        const mark = markOffsets.get(index);
        if (!mark && kernable && glyph.glyphId) {
          pairs.push(kernable, glyph.glyphId);
          kerned.push(index);
        }
        if (mark?.to != null) continue;
        kernable = mark ? null : glyph.glyphId;
      }
    }
    if (kerned.length === 0) return new Map();

    const values = this.#editor.font.kerningRun(
      pairs,
      this.#externalLocation.peek(),
      this.#editor.activeSourceIdCell.peek(),
    );
    return new Map(kerned.map((index, pair) => [index, values[pair] ?? 0]));
  }

  #runGlyph(run: SegmentedRun, shaped: ShapedGlyph): RunGlyph {
    const font = this.#editor.font;
    const entry = shaped.glyphId ? font.entryForId(shaped.glyphId) : null;
    if (entry) {
      return {
        shaped,
        glyphId: entry.id,
        name: entry.name,
        model: this.#model(entry.id),
      };
    }
    // No glyph: a character the font lacks keeps the name it would take; a missing pick is .notdef.
    const item = run.items[shaped.cluster];
    const codepoint = item?.kind === "character" ? item.codepoint : null;
    return {
      shaped,
      glyphId: null,
      name: codepoint === null ? NOTDEF : font.nameForUnicode(codepoint as Unicode),
      model: null,
    };
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
   * mark with the matching anchor (mark to mark), otherwise to the base. A
   * glyph is a mark when it has an `_name` anchor its target has as `name`.
   */
  #anchorOffsets(run: SegmentedRun, glyphs: readonly RunGlyph[]): Map<number, MarkOffset> {
    const offsets = new Map<number, MarkOffset>();
    let base: number | null = null;
    let previousMark: number | null = null;
    for (const index of logicalIndexes(run)) {
      const model = glyphs[index]?.model ?? null;
      // Inside the run's layout computed: anchor edits, here or in a component, re-run the layout.
      if (model) track(model.anchorsWithComponentsCell);
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
      glyph.glyphId && source ? this.#editor.layerForGlyph(glyph.glyphId, source.id) : null;
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
  for (const markAnchor of mark.anchorsWithComponents) {
    if (!markAnchor.name.startsWith("_")) continue;
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
