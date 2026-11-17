import { useMemo, useRef } from "react";
import { useLocation } from "react-router";
import type { GlyphId, MarkColor } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  X,
} from "@shift/ui";
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

/**
 * The glyphs' tag colour beside the Glyph heading, as a dot for each colour
 * they have (a hollow one when they have none). Clicking it opens the colour
 * picker, which says Mixed when the glyphs differ.
 */
export function GlyphTagButton() {
  const session = useFontSession();
  const { glyphIds, colors } = useGlyphTag();
  const trigger = useRef<HTMLButtonElement>(null);
  if (glyphIds.length === 0) return null;

  const tags = colors
    .values()
    .filter((color) => color !== null)
    .toArray();
  const label = tags.length > 0 ? `Colour, ${tags.map(markColorLabel).join(", ")}` : "Colour";
  const dots =
    tags.length > 0 ? (
      tags.map((color) => (
        <span
          key={markColorKey(color)}
          className="block h-2.5 w-2.5 rounded-full"
          // A tag's colour is data.
          style={{ background: markColorCss(color) }}
        />
      ))
    ) : (
      <span className="block h-2.5 w-2.5 rounded-full border border-control-muted" />
    );
  // A preview session reads tags but cannot write them.
  if (session.mode !== "workspace") {
    return (
      <span role="img" aria-label={label} className="flex gap-1">
        {dots}
      </span>
    );
  }

  return (
    <Popover modal={false}>
      <PopoverTrigger
        render={
          <Button
            ref={trigger}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="w-auto gap-1 px-1"
          >
            {dots}
          </Button>
        }
      />
      <PopoverPortal>
        {/* Beside the sidebar like its other panels: right border over the sidebar's, top on the divider above the Glyph block. */}
        <PopoverPositioner
          anchor={() => trigger.current?.closest("section")?.parentElement ?? null}
          side="left"
          align="start"
          sideOffset={-1}
          alignOffset={-1}
        >
          <PopoverPopup className="flex w-max flex-col p-0">
            <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pl-2 pr-1">
              <PopoverTitle>Colour</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>
            <div className="flex flex-col gap-1 p-2">
              <MarkColorPicker
                layout="grid"
                current={colors}
                onPick={(color) => session.editor.setMarkColor(glyphIds, color)}
              />
              {colors.size > 1 ? <span className="px-1 text-ui text-secondary">Mixed</span> : null}
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
