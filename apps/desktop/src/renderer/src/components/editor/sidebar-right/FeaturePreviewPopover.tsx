import { useMemo, useRef, useState, type RefObject } from "react";
import type { FontFeature, TextRunRecord } from "@shift/editor/text";
import type { GlyphId } from "@shift/types";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  Tooltip,
  X,
  cn,
} from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { GlyphSelection } from "../../glyph-grid/GlyphSelection";
import { copyGlyphNames } from "../../glyph-grid/glyphNames";
import { useGlyphSelection } from "../../glyph-grid/useGlyphSelection";
import { GlyphThumbnail } from "../../kerning/groups/GlyphThumbnail";
import { glyphName } from "../../kerning/groups/previewGlyphs";
import { featureName } from "../featureNames";
import { MAX_PREVIEW_GLYPHS, inputItems, insertIntoRun, useFeatureGlyphs } from "./featureGlyphs";

/** How a feature tag is shown wherever features are listed; callers add its colour. */
export const TAG_PILL = "shrink-0 rounded bg-input px-1.5 py-0.5 font-mono text-ui font-normal";

/** The size of each glyph in the preview, in CSS pixels. */
const PREVIEW_GLYPH_PX = 32;

const NO_GLYPHS: readonly GlyphId[] = [];

const PLAIN_CLICK = { range: false, toggle: false };

interface FeaturePreviewPopoverProps {
  /** The proof text the features apply to, which Insert into Text adds to. */
  readonly run: TextRunRecord;
  /** The feature to preview; null while closed. */
  readonly feature: FontFeature | null;
  /** The sidebar block the preview opens beside, level with its top. */
  readonly anchor: RefObject<HTMLElement | null> | null;
  readonly onClose: () => void;
}

/**
 * What a feature changes, beside the sidebar: opened by clicking a feature's
 * tag, with the feature's tag and name, the glyphs it brings in, and a close
 * button. Clicking another tag while it is open switches it to that feature.
 */
export function FeaturePreviewPopover({
  run,
  feature,
  anchor,
  onClose,
}: FeaturePreviewPopoverProps) {
  const name = feature ? featureName(feature) : null;
  return (
    <Popover
      open={feature !== null}
      onOpenChange={(next, details) => {
        if (next) return;
        // A feature tag switches the open preview to its feature; it does not close it first.
        const target = details.event.target;
        const onTag = target instanceof Element && target.closest("[data-feature-tag]") !== null;
        if (details.reason === "outside-press" && onTag) return;

        onClose();
      }}
      modal={false}
    >
      <PopoverPortal>
        <PopoverPositioner
          anchor={anchor}
          side="left"
          align="start"
          // Shift to stay on screen rather than flip, so its top stays level with the block's where it can.
          collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
          sideOffset={-1}
          alignOffset={-1}
        >
          {feature ? (
            <PopoverPopup className="flex w-72 flex-col p-0">
              <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn(TAG_PILL, "text-primary")}>{feature.tag}</span>
                  <span className="min-w-0 truncate">
                    <PopoverTitle>{name ?? feature.tag}</PopoverTitle>
                  </span>
                </span>
                <Tooltip content="Close">
                  <PopoverClose variant="icon" aria-label="Close">
                    <X className="h-4 w-4" />
                  </PopoverClose>
                </Tooltip>
              </div>
              <FeaturePreview key={feature.tag} run={run} tag={feature.tag} />
            </PopoverPopup>
          ) : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}

interface FeaturePreviewProps {
  readonly run: TextRunRecord;
  readonly tag: string;
}

/**
 * Every glyph a feature brings in, drawn in the font, as kerning previews a
 * group's members. Glyphs select as in a group preview: click, Shift-click
 * or drag for a range, ⌘-click to add or remove one, and the arrow keys.
 * The context menu copies the selection's names (also ⌘C) or inserts what
 * it replaces into the text, so the feature shapes it there.
 */
const FeaturePreview = ({ run, tag }: FeaturePreviewProps) => {
  const editor = useEditor();
  const glyphs = useFeatureGlyphs(tag);
  const shown = useMemo(
    () => glyphs.slice(0, MAX_PREVIEW_GLYPHS).map(({ glyph }) => glyph),
    [glyphs],
  );
  const [selection, setSelection] = useState(() => GlyphSelection.empty(NO_GLYPHS));
  const current = selection.withGlyphs(shown);
  const containerRef = useRef<HTMLDivElement>(null);
  const glyphAt = (clientX: number, clientY: number): GlyphId | null => {
    const cell = document.elementFromPoint(clientX, clientY)?.closest("[data-preview-glyph]");
    if (!cell || !containerRef.current?.contains(cell)) return null;

    return shown[Number(cell.getAttribute("data-preview-glyph"))] ?? null;
  };
  const copy = () => void copyGlyphNames(editor, current.ids);
  const insert = () => {
    const replaced = new Map(glyphs.map((entry) => [entry.glyph, entry.replaces[0] ?? []]));
    const sequences = current.ids.map((id) => replaced.get(id) ?? []);
    insertIntoRun(editor, run, inputItems(editor, sequences));
  };
  const select = useGlyphSelection({
    selection: current,
    onSelect: setSelection,
    containerRef,
    glyphAt,
    onCopy: copy,
  });

  if (shown.length === 0) {
    return (
      <div className="p-2">
        <p className="flex h-32 items-center justify-center rounded-md bg-input text-ui text-secondary">
          No glyph changes to show
        </p>
      </div>
    );
  }

  return (
    <div className="p-2">
      <ContextMenu>
        <ContextMenuTrigger
          className="contents"
          onContextMenu={(event) => {
            // A right-click on a glyph outside the selection acts on that glyph alone.
            const id = glyphAt(event.clientX, event.clientY);
            if (id && !current.has(id)) setSelection(current.click(id, PLAIN_CLICK));
          }}
        >
          <div
            ref={containerRef}
            tabIndex={0}
            role="listbox"
            aria-multiselectable
            aria-label={`Glyphs ${tag} brings in`}
            className="scrollbar-hidden flex h-32 flex-wrap content-start items-center gap-1.5 overflow-y-auto rounded-md bg-input p-2 outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            {...select}
          >
            {shown.map((glyph, index) => (
              <div
                key={glyph}
                role="option"
                aria-label={glyphName(editor, glyph)}
                aria-selected={current.has(glyph)}
                data-preview-glyph={index}
                className={cn(
                  "flex cursor-pointer rounded p-0.5",
                  current.has(glyph) ? "bg-accent/20" : "hover:bg-hover",
                )}
              >
                <GlyphThumbnail glyphId={glyph} size={PREVIEW_GLYPH_PX} />
              </div>
            ))}
          </div>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuPositioner>
            <ContextMenuPopup className="w-auto">
              <ContextMenuItem disabled={current.isEmpty} onClick={copy}>
                Copy Names
                <span className="ml-auto pl-3 text-secondary">⌘C</span>
              </ContextMenuItem>
              <ContextMenuItem disabled={current.isEmpty} onClick={insert}>
                Insert into Text
              </ContextMenuItem>
            </ContextMenuPopup>
          </ContextMenuPositioner>
        </ContextMenuPortal>
      </ContextMenu>
    </div>
  );
};
