import { useMemo, useState, type RefObject } from "react";
import type { RequiredGlyph } from "@shift/glyph-info";
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
  X,
} from "@shift/ui";
import { useCheckboxRange } from "@/hooks/useCheckboxRange";
import type { LanguageGlyph } from "@/types/glyphCatalog";
import { useMemberSet } from "@/hooks/useMemberSet";

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 320;
const OVERSCAN_ROWS = 4;

export interface MissingGlyphsPopoverProps {
  anchor: RefObject<HTMLElement | null>;
  languageName: string;
  glyphs: readonly LanguageGlyph[] | null;
  canGenerate: boolean;
  onClose: () => void;
  onGenerate: (glyphs: readonly RequiredGlyph[]) => void;
}

/**
 * Lists every glyph a language or script group requires, positional forms and
 * ligatures included. Glyphs the font has show ticked and fixed; ticked
 * missing glyphs are generated as empty glyphs.
 */
export const MissingGlyphsPopover = ({
  anchor,
  languageName,
  glyphs,
  canGenerate,
  onClose,
  onGenerate,
}: MissingGlyphsPopoverProps) => {
  const selection = useMemberSet<string>();
  const selected = selection.values;
  const [scrollTop, setScrollTop] = useState(0);
  const names = useMemo(() => glyphs?.map(({ glyph }) => glyph.name) ?? [], [glyphs]);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    glyphs?.length ?? 0,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const visibleGlyphs = glyphs?.slice(firstRow, lastRow) ?? [];
  const { onMouseDown, itemsToChange, resetRange } = useCheckboxRange(names);
  const missingGlyphs = useMemo(
    () => glyphs?.filter(({ present }) => !present).map(({ glyph }) => glyph) ?? [],
    [glyphs],
  );
  const missingNames = useMemo(() => missingGlyphs.map(({ name }) => name), [missingGlyphs]);
  const allSelected = missingNames.length > 0 && selected.size === missingNames.length;

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    selection.clear();
    setScrollTop(0);
    resetRange();
    onClose();
  };

  const setChecked = (target: string, checked: boolean) => {
    const missing = new Set(missingNames);
    selection.setMany(
      itemsToChange(target).filter((name) => missing.has(name)),
      checked,
    );
  };

  const generate = () => {
    onGenerate(missingGlyphs.filter(({ name }) => selected.has(name)));
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
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>

            <div
              role="group"
              aria-label={`Missing glyphs for ${languageName}`}
              className="max-h-80 overflow-y-auto p-1"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="relative" style={{ height: (glyphs?.length ?? 0) * ROW_HEIGHT }}>
                {visibleGlyphs.map(({ glyph: { name }, preview, present }, index) => (
                  <label
                    key={name}
                    className="absolute flex h-10 w-full cursor-pointer select-none items-center gap-2 rounded px-1 text-ui text-primary hover:bg-hover"
                    style={{ top: (firstRow + index) * ROW_HEIGHT }}
                    onMouseDown={onMouseDown}
                  >
                    <Checkbox
                      checked={present || selected.has(name)}
                      onCheckedChange={(checked) => setChecked(name, checked)}
                      disabled={present || !canGenerate}
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span
                      aria-hidden
                      className="w-10 shrink-0 text-center text-3xl leading-none text-muted"
                    >
                      {preview}
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
                  disabled={!canGenerate || missingNames.length === 0}
                  onClick={() => {
                    selection.clear();
                    if (!allSelected) selection.setMany(missingNames, true);
                  }}
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
