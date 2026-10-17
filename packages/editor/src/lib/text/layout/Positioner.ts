import { track } from "../../signals";
import { displayAdvance } from "../../utils/displayAdvance";
import type { GlyphTextItem, PositionedRun, SegmentedRun } from "./types";
import type { Editor } from "../../editor/Editor";
import type { Font } from "../../model/Font";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";
import type { Bounds, Point2D } from "@shift/geo";
import type { GlyphEntry, Source } from "@shift/types";

/**
 * No-shape positioner — literal LTR advance walk, `cluster = clusterStart + i`.
 * Permanent product mode for editing scripts where the user wants source-order
 * glyph display without joining/contextual substitution (e.g. Arabic
 * side-by-side editing).
 *
 * Neighbouring spacing glyphs are kerned with the font's pair kerning at the
 * displayed location; a mark between them interrupts the pair. A glyph is a
 * mark when export resolves it as a nonspacing mark ({@link Font.isNonspacingMark});
 * a character with no glyph in the font counts as spacing.
 */
export class Positioner {
  position(
    run: SegmentedRun,
    editor: Editor,
    externalLocation: Signal<ExternalAxisLocation>,
  ): PositionedRun {
    let totalAdvance = 0;
    const glyphs: PositionedRun["glyphs"] = [];
    const source = editor.activeSource ?? editor.font.sourceAtOrDefault(externalLocation.peek());
    // Called from the run's layout computed, which tracks location and active source.
    track(editor.font.kerningCell);
    let kernable: PositionedRun["glyphs"][number] | null = null;

    for (const [idx, g] of run.glyphs.entries()) {
      const entry = editor.font.entryForName(g.glyphName);
      const glyph = entry ? editor.glyphForId(entry.id) : null;
      const renderModel = glyph?.renderModelAt(externalLocation, editor.activeSourceIdCell) ?? null;
      let glyphName = g.glyphName;
      let bounds: Bounds | null = null;

      if (entry && renderModel) {
        // Inside the run's layout computed: spacing edits re-run the layout.
        track(renderModel.xAdvanceCell);
        glyphName = entry.name;
        bounds = renderModel.bounds;
      }

      const nonspacingMark = editor.font.isNonspacingMark(g.glyphName);
      const xAdvance = displayAdvance(renderModel?.xAdvance ?? 0, nonspacingMark);
      const spacing = !nonspacingMark;
      if (kernable?.glyphId && entry && spacing) {
        kernable.xKern = editor.font.kerningBetween(
          kernable.glyphId,
          entry.id,
          externalLocation.peek(),
          editor.activeSourceIdCell.peek(),
        );
        totalAdvance += kernable.xKern;
      }
      const origin = { x: totalAdvance, y: 0 };
      const offset = nonspacingMark ? markOffset(g, editor, source) : { x: 0, y: 0 };
      totalAdvance += xAdvance;

      const positioned = {
        glyphId: entry?.id ?? null,
        glyphName,
        sourceItemIds: [g.id],
        origin,
        xAdvance,
        xKern: 0,
        yAdvance: 0,
        xOffset: offset.x,
        yOffset: offset.y,
        cluster: run.clusterStart + idx,
        bounds,
      };
      glyphs.push(positioned);
      kernable = spacing ? positioned : null;
    }

    return { ...run, glyphs, advance: totalAdvance };
  }
}

/** Offset that sits a nonspacing mark over its stand-in advance, by its attaching anchor or its bounds. */
function markOffset(item: GlyphTextItem, editor: Editor, source: Source | null): Point2D {
  if (!source) return { x: 0, y: 0 };

  const record = recordForTextItem(item, editor.font);
  const glyph = record ? editor.glyphForId(record.id) : null;
  const layer = glyph?.layerForSource(source.id) ?? null;
  if (!layer) return { x: 0, y: 0 };

  const metrics = editor.font.defaultSourceMetrics;
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

function recordForTextItem(item: GlyphTextItem, font: Font): GlyphEntry | null {
  return font.entryForName(item.glyphName);
}
