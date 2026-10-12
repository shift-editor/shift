import type { Point2D } from "@shift/geo";
import type { GlyphEntry, GlyphName, ShapedGlyph } from "@shift/types";
import { track } from "../../signals";
import { displayAdvance } from "../../utils/unicode";
import { textItemGlyph } from "./textItemGlyph";
import type { PositionedGlyph, PositionedRun, SegmentedRun } from "./types";
import type { Editor } from "../../editor/Editor";
import type { GlyphRenderModel } from "../../model/Glyph";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";

interface Anchor {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** One shaped glyph resolved against the live font. */
interface LiveGlyph {
  readonly shaped: ShapedGlyph;
  readonly entry: GlyphEntry | null;
  readonly name: GlyphName;
  readonly codepoint: number | null;
  readonly renderModel: GlyphRenderModel | null;
  readonly anchors: readonly Anchor[];
  /** The glyph and anchor offset a mark attaches to; null for a base or an unattached mark. */
  attachment: { readonly to: LiveGlyph; readonly offset: Point2D } | null;
  positioned: PositionedGlyph | null;
}

/**
 * Positions shaped glyphs with live data.
 *
 * The shaper substitutes glyphs and applies the feature code's own
 * positioning; this adds what export would generate from structured data:
 * each glyph's live advance, pair kerning between neighbours in a
 * left-to-right run, and mark attachment from anchors. A glyph is a mark when
 * it has an `_name` anchor and the glyph before it in logical order (a base,
 * or a mark for mark-to-mark) has the matching `name` anchor.
 */
export class ShapingPositioner {
  /**
   * @param shaped - The run's glyphs from the shaper, in visual order, with
   *   clusters indexing the run's items.
   */
  position(
    run: SegmentedRun,
    shaped: readonly ShapedGlyph[],
    editor: Editor,
    externalLocation: Signal<ExternalAxisLocation>,
  ): PositionedRun {
    // Called from the run's layout computed, which tracks location and active source.
    track(editor.font.kerningCell);
    const glyphs = shaped.map((glyph) => liveGlyph(run, glyph, editor, externalLocation));
    const logical = run.direction === "rtl" ? [...glyphs].reverse() : glyphs;
    attachMarks(logical);

    let pen = 0;
    let kernable: PositionedGlyph | null = null;
    for (const glyph of glyphs) {
      const { entry } = glyph;
      const attached = glyph.attachment !== null;
      if (!attached && kernable?.glyphId && entry && run.direction === "ltr") {
        kernable.xKern = editor.font.kerningBetween(
          kernable.glyphId,
          entry.id,
          externalLocation.peek(),
          editor.activeSourceIdCell.peek(),
        );
        pen += kernable.xKern;
      }

      const xAdvance = attached ? 0 : advance(glyph) + glyph.shaped.xAdvance;
      glyph.positioned = {
        glyphId: entry?.id ?? null,
        glyphName: glyph.name,
        sourceItemIds: itemIds(run, shaped, glyph.shaped.cluster),
        origin: { x: pen, y: 0 },
        xAdvance,
        xKern: 0,
        yAdvance: glyph.shaped.yAdvance,
        xOffset: glyph.shaped.xOffset,
        yOffset: glyph.shaped.yOffset,
        cluster: run.clusterStart + glyph.shaped.cluster,
        bounds: glyph.renderModel?.bounds ?? null,
      };
      if (!attached) {
        pen += xAdvance;
        kernable = glyph.positioned;
      }
    }

    // In logical order, so a mark's target (a base or an earlier mark) is placed first.
    for (const glyph of logical) {
      const target = glyph.attachment?.to.positioned;
      if (!glyph.attachment || !target || !glyph.positioned) continue;
      glyph.positioned.origin = { ...target.origin };
      glyph.positioned.xOffset += target.xOffset + glyph.attachment.offset.x;
      glyph.positioned.yOffset += target.yOffset + glyph.attachment.offset.y;
    }

    const positioned = glyphs.flatMap((glyph) => (glyph.positioned ? [glyph.positioned] : []));
    return { ...run, glyphs: positioned, advance: pen };
  }
}

function liveGlyph(
  run: SegmentedRun,
  shaped: ShapedGlyph,
  editor: Editor,
  externalLocation: Signal<ExternalAxisLocation>,
): LiveGlyph {
  const font = editor.font;
  const entry = shaped.glyphId ? font.entryForId(shaped.glyphId) : null;
  const item = run.items[shaped.cluster];
  const fallback = item ? textItemGlyph(item, font) : null;
  const glyph = entry ? editor.glyphForId(entry.id) : null;
  const renderModel = glyph?.renderModelAt(externalLocation, editor.activeSourceIdCell) ?? null;
  let anchors: readonly Anchor[] = [];
  if (renderModel) {
    // Inside the run's layout computed: advance and anchor edits re-run the layout.
    track(renderModel.xAdvanceCell);
    track(renderModel.anchorsCell);
    anchors = renderModel.anchors.flatMap((anchor) => {
      anchor.trackShape();
      return anchor.name ? [{ name: anchor.name, x: anchor.x, y: anchor.y }] : [];
    });
  }

  return {
    shaped,
    entry,
    name: (entry?.name ?? fallback?.name ?? ".notdef") as GlyphName,
    codepoint: entry?.unicodes[0] ?? fallback?.codepoint ?? null,
    renderModel,
    anchors,
    attachment: null,
    positioned: null,
  };
}

/**
 * Attaches each mark to the glyph before it in logical order: to a preceding
 * mark with the matching anchor (mark to mark), otherwise to the base.
 */
function attachMarks(logical: readonly LiveGlyph[]): void {
  let base: LiveGlyph | null = null;
  let previousMark: LiveGlyph | null = null;
  for (const glyph of logical) {
    const attaching = glyph.anchors.filter((anchor) => anchor.name.startsWith("_"));
    const attachment = attachTo(previousMark, attaching) ?? attachTo(base, attaching) ?? null;
    if (attachment) {
      glyph.attachment = attachment;
      previousMark = glyph;
      continue;
    }
    base = glyph;
    previousMark = null;
  }
}

function attachTo(target: LiveGlyph | null, attaching: readonly Anchor[]): LiveGlyph["attachment"] {
  if (!target) return null;
  for (const markAnchor of attaching) {
    const name = markAnchor.name.slice(1);
    const targetAnchor = target.anchors.find((anchor) => anchor.name === name);
    if (targetAnchor) {
      return {
        to: target,
        offset: { x: targetAnchor.x - markAnchor.x, y: targetAnchor.y - markAnchor.y },
      };
    }
  }
  return null;
}

function advance(glyph: LiveGlyph): number {
  return displayAdvance(glyph.renderModel?.xAdvance ?? 0, glyph.name, glyph.codepoint);
}

/** Returns the items a glyph at `cluster` covers: up to the run's next cluster. */
function itemIds(
  run: SegmentedRun,
  shaped: readonly ShapedGlyph[],
  cluster: number,
): PositionedGlyph["sourceItemIds"] {
  const next = shaped.reduce(
    (end, glyph) => (glyph.cluster > cluster && glyph.cluster < end ? glyph.cluster : end),
    run.items.length,
  );
  return run.items.slice(cluster, next).map((item) => item.id);
}
