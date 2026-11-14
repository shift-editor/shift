import { useMemo } from "react";
import { useLocation } from "react-router";
import type { GlyphId, MarkColor } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import { MarkColorPicker } from "@/components/glyph-grid/MarkColorPicker";
import {
  markColorCss,
  markColorKey,
  markColorLabel,
  type MarkColorKey,
} from "@/lib/glyph-grid/markColor";
import { tagTargetsOf } from "@/lib/glyph-grid/tagTargets";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** The glyphs the sidebar tags, and the colours they have now, by key. */
interface GlyphTagState {
  readonly glyphIds: readonly GlyphId[];
  readonly colors: ReadonlyMap<MarkColorKey, MarkColor | null>;
}

/**
 * Follows the glyphs a colour applies to: the grid's selection on the font
 * overview, else the glyph the canvas shows.
 */
function useGlyphTag(): GlyphTagState {
  const session = useFontSession();
  const { pathname } = useLocation();
  const selection = useSignalState(session.tabs.gridSelectionCell);
  const shown = useSignalState(session.editor.scene.onlyCell("glyph"))?.glyphId ?? null;
  const records = useSignalState(session.font.glyphRecordsCell);

  return useMemo(() => {
    const glyphIds = tagTargetsOf(pathname, selection.ids, shown);
    const targets = new Set(glyphIds);
    const tagged = records.filter((record) => targets.has(record.id));
    const colors = new Map(
      tagged.map((record) => [markColorKey(record.markColor), record.markColor ?? null]),
    );
    return { glyphIds, colors };
  }, [pathname, records, selection, shown]);
}

/** A dot beside the Glyph heading for each tag colour the glyphs have. */
export function GlyphTagDots() {
  const { colors } = useGlyphTag();
  const tags = colors
    .values()
    .filter((color) => color !== null)
    .toArray();
  if (tags.length === 0) return null;

  return (
    <span
      role="img"
      aria-label={`Tagged ${tags.map(markColorLabel).join(", ")}`}
      className="flex gap-1"
    >
      {tags.map((color) => (
        <span
          key={markColorKey(color)}
          className="block h-2 w-2 rounded-full border border-tile-ink"
          // A tag's colour is data.
          style={{ background: markColorCss(color) }}
        />
      ))}
    </span>
  );
}

/** The sidebar's row of tag colours for the glyphs; says Mixed when they differ. */
export function GlyphTagRow() {
  const session = useFontSession();
  const { glyphIds, colors } = useGlyphTag();
  if (session.mode !== "workspace" || glyphIds.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <MarkColorPicker
        current={colors}
        onPick={(color) => session.editor.setMarkColor(glyphIds, color)}
      />
      {colors.size > 1 ? <span className="text-ui text-secondary">Mixed</span> : null}
    </div>
  );
}
