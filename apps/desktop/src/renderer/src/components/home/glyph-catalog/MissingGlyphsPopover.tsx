import { useMemo, useState, type RefObject } from "react";
import {
  Button,
  Checkbox,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import { useCheckboxRange } from "@/hooks/useCheckboxRange";
import type { LanguageGlyph } from "@/types/glyphCatalog";

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 320;
const OVERSCAN_ROWS = 4;

export interface MissingGlyphsPopoverProps {
  anchor: RefObject<HTMLElement | null>;
  languageName: string;
  glyphs: readonly LanguageGlyph[] | null;
  canGenerate: boolean;
  onClose: () => void;
  onGenerate: (codepoints: readonly number[]) => void;
}

/**
 * Lists every character a language requires. Characters the font has show
 * ticked and fixed; ticked missing characters are generated as empty glyphs.
 */
export const MissingGlyphsPopover = ({
  anchor,
  languageName,
  glyphs,
  canGenerate,
  onClose,
  onGenerate,
}: MissingGlyphsPopoverProps) => {
  const [selectedCodepoints, setSelectedCodepoints] = useState<readonly number[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const codepoints = useMemo(() => glyphs?.map(({ codepoint }) => codepoint) ?? [], [glyphs]);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    glyphs?.length ?? 0,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const visibleGlyphs = glyphs?.slice(firstRow, lastRow) ?? [];
  const selected = useMemo(() => new Set(selectedCodepoints), [selectedCodepoints]);
  const { onMouseDown, itemsToChange, resetRange } = useCheckboxRange(codepoints);
  const missingCodepoints = useMemo(
    () => glyphs?.filter(({ present }) => !present).map(({ codepoint }) => codepoint) ?? [],
    [glyphs],
  );
  const allSelected = missingCodepoints.length > 0 && selected.size === missingCodepoints.length;

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    setSelectedCodepoints([]);
    setScrollTop(0);
    resetRange();
    onClose();
  };

  const setChecked = (target: number, checked: boolean) => {
    const missing = new Set(missingCodepoints);
    const affected = new Set(itemsToChange(target).filter((codepoint) => missing.has(codepoint)));
    setSelectedCodepoints((previous) => {
      const next = new Set(previous);
      for (const codepoint of affected) {
        if (checked) next.add(codepoint);
        else next.delete(codepoint);
      }
      return [...next];
    });
  };

  const generate = () => {
    onGenerate(missingCodepoints.filter((codepoint) => selected.has(codepoint)));
    handleOpenChange(false);
  };

  return (
    <Popover open={glyphs !== null} onOpenChange={handleOpenChange} modal={false}>
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} side="right" sideOffset={8} align="start">
          <PopoverPopup className="flex w-64 flex-col p-0">
            <div className="flex h-8 items-center justify-between gap-2 border-b border-line-subtle px-2">
              <div className="min-w-0 truncate">
                <PopoverTitle>Missing Glyphs</PopoverTitle>
              </div>
              <Tooltip>
                <TooltipTrigger>
                  <PopoverClose variant="icon" aria-label="Close">
                    <X className="h-4 w-4" />
                  </PopoverClose>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>

            <div
              role="group"
              aria-label={`Missing glyphs for ${languageName}`}
              className="scrollbar-themed max-h-80 overflow-y-auto p-1"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="relative" style={{ height: (glyphs?.length ?? 0) * ROW_HEIGHT }}>
                {visibleGlyphs.map(({ codepoint, name, present }, index) => (
                  <label
                    key={codepoint}
                    className="absolute flex h-10 w-full cursor-pointer select-none items-center gap-2 rounded px-1 text-ui text-primary hover:bg-hover"
                    style={{ top: (firstRow + index) * ROW_HEIGHT }}
                    onMouseDown={onMouseDown}
                  >
                    <Checkbox
                      checked={present || selected.has(codepoint)}
                      onCheckedChange={(checked) => setChecked(codepoint, checked)}
                      disabled={present || !canGenerate}
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span
                      aria-hidden
                      className="w-10 shrink-0 text-center text-3xl leading-none text-muted"
                    >
                      {String.fromCodePoint(codepoint)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {glyphs && glyphs.length > 0 && (
              <div className="grid grid-cols-2 gap-2 border-t border-line-subtle p-2">
                <Button
                  type="button"
                  className="h-7.5 text-ui"
                  disabled={!canGenerate || missingCodepoints.length === 0}
                  onClick={() => setSelectedCodepoints(allSelected ? [] : missingCodepoints)}
                >
                  {allSelected ? "Deselect All" : "Select All"}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="h-7.5 text-ui"
                  disabled={!canGenerate || selected.size === 0}
                  onClick={generate}
                >
                  Generate
                </Button>
              </div>
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};
