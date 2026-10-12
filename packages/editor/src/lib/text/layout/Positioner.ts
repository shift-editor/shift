import { track } from "../../signals";
import { displayAdvance, isNonSpacingGlyph } from "../../utils/unicode";
import { textItemGlyph, type TextItemGlyph } from "./textItemGlyph";
import type { PositionedRun, SegmentedRun } from "./types";
import type { Editor } from "../../editor/Editor";
import type { GlyphRenderModel } from "../../model/Glyph";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";
import type { Bounds, Point2D } from "@shift/geo";
import type { Source } from "@shift/types";

/**
 * No-shape positioner — literal LTR advance walk, `cluster = clusterStart + i`.
 * Permanent product mode for editing scripts where the user wants source-order
 * glyph display without joining/contextual substitution (e.g. Arabic
 * side-by-side editing).
 *
 * Neighbouring spacing glyphs are kerned with the font's pair kerning at the
 * displayed location; a mark between them interrupts the pair.
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

    for (const [idx, item] of run.items.entries()) {
      const resolved = textItemGlyph(item, editor.font);
      const { entry } = resolved;
      const glyph = entry ? editor.glyphForId(entry.id) : null;
      const renderModel = glyph?.renderModelAt(externalLocation, editor.activeSourceIdCell) ?? null;
      let bounds: Bounds | null = null;

      if (renderModel) {
        // Inside the run's layout computed: spacing edits re-run the layout.
        track(renderModel.xAdvanceCell);
        bounds = renderModel.bounds;
      }

      const xAdvance = resolveAdvance(resolved, renderModel);
      const spacing = !isNonSpacingGlyph(resolved.name, resolved.codepoint);
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
      const offset = resolveGlyphOffset(resolved, editor, source);
      totalAdvance += xAdvance;

      const positioned = {
        glyphId: entry?.id ?? null,
        glyphName: resolved.name,
        sourceItemIds: [item.id],
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

/** Resolve an item's glyph to its display advance (handles invisibles, fallbacks). */
function resolveAdvance(glyph: TextItemGlyph, view: GlyphRenderModel | null): number {
  const raw = view?.xAdvance ?? 0;
  return displayAdvance(raw, glyph.name, glyph.codepoint);
}

function resolveGlyphOffset(
  resolved: TextItemGlyph,
  editor: Editor,
  source: Source | null,
): Point2D {
  if (!isNonSpacingGlyph(resolved.name, resolved.codepoint)) return { x: 0, y: 0 };
  if (!source) return { x: 0, y: 0 };

  const glyph = resolved.entry ? editor.glyphForId(resolved.entry.id) : null;
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
