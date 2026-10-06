import { isTextItemId, type GlyphId } from "@shift/types";
import type { Editor } from "../lib/editor/Editor";
import type { Glyph } from "../lib/model/Glyph";
import { track } from "../lib/signals";
import type { GlyphTextItem } from "../lib/text/layout";
import type { GlyphMetric } from "./types";

const METRIC_LABELS: Record<GlyphMetric, string> = {
  advance: "Set advance width",
  left: "Set left sidebearing",
  right: "Set right sidebearing",
};

/**
 * Returns the glyphs the glyph sidebar shows and edits, each once.
 *
 * @remarks
 * In Text mode, the glyphs the caret targets. Otherwise the glyphs of the
 * selected run items, or the glyph of the entered glyph node. Reactive: a
 * computed reading it reruns when Text mode, the caret, the selection, or the
 * entered node changes.
 */
export function sidebarGlyphs(editor: Editor): readonly Glyph[] {
  track(editor.textEditing.stateCell);
  if (editor.textEditing.state) return glyphsForItems(editor, editor.textEditing.targetItems());

  track(editor.selection.stateCell);
  const selected = editor.selection.ids.flatMap((id) => {
    const item = isTextItemId(id) ? editor.text.itemLocation(id)?.item : null;
    return item?.kind === "glyph" ? [item] : [];
  });
  if (selected.length > 0) return glyphsForItems(editor, selected);

  track(editor.editing.stateCell);
  const node = editor.editing.node("glyph");
  const glyph = node ? editor.glyphForId(node.glyphId) : null;
  return glyph ? [glyph] : [];
}

/**
 * Sets one metric on every glyph's layer at the active source, as one undo step.
 *
 * @remarks
 * Glyphs without a layer at the active source are skipped. Does nothing
 * without an active source.
 *
 * @param value - The new advance width or sidebearing, in UPM units.
 */
export function setGlyphMetric(
  editor: Editor,
  glyphs: readonly Glyph[],
  metric: GlyphMetric,
  value: number,
): void {
  const sourceId = editor.activeSourceId;
  if (!sourceId) return;

  const layers = glyphs.flatMap((glyph) => glyph.layerForSource(sourceId) ?? []);
  if (layers.length === 0) return;

  editor.transaction(METRIC_LABELS[metric], () => {
    for (const layer of layers) {
      switch (metric) {
        case "advance":
          layer.setXAdvance(value);
          break;
        case "left":
          layer.setLeftSidebearing(value);
          break;
        case "right":
          layer.setRightSidebearing(value);
          break;
      }
    }
  });
}

function glyphsForItems(editor: Editor, items: readonly GlyphTextItem[]): readonly Glyph[] {
  const glyphs = new Map<GlyphId, Glyph>();
  for (const item of items) {
    const entry = editor.font.entryForName(item.glyphName);
    const glyph = entry ? editor.glyphForId(entry.id) : null;
    if (entry && glyph) glyphs.set(entry.id, glyph);
  }
  return [...glyphs.values()];
}
