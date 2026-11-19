import { useMemo, useState } from "react";
import type { GlyphId, GlyphName } from "@shift/types";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Search,
  Tooltip,
  X,
} from "@shift/ui";
import PlusIcon from "@/assets/general/plus.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { NameQuery } from "@/lib/utils/NameQuery";
import type { SwapGlyphChoice } from "@/types/conditions";

/** The most glyphs the picker lists at once; typing narrows them. */
const SHOWN = 100;

/**
 * The Swaps section's **+** and the panel it opens beside the sidebar:
 * a search over the font's glyphs, the edited glyph left out, with "Create
 * `<glyph>.alt`" first. Picking one hands it back; the section then starts
 * its first chip.
 */
export const NewSwapPanel = ({
  glyphId,
  newGlyphName,
  onPick,
}: {
  /** The edited glyph, which can't be its own swap. */
  glyphId: GlyphId;
  /** The name a created swap glyph takes, `dollar.alt`. */
  newGlyphName: GlyphName;
  onPick: (choice: SwapGlyphChoice) => void;
}) => {
  const catalog = useGlyphCatalog();
  const panelAnchor = useSidebarPanelAnchor();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const choices = useMemo(() => {
    const glyphs = NameQuery.from(query)
      .filterBy(
        catalog.availableGlyphs.filter((glyph) => glyph.id !== glyphId),
        (glyph) => [glyph.name, glyph.displayName],
      )
      .slice(0, SHOWN)
      .map((glyph): SwapGlyphChoice => ({ kind: "glyph", glyphId: glyph.id, name: glyph.name }));
    const create: SwapGlyphChoice = { kind: "create", name: newGlyphName };
    return [create, ...glyphs];
  }, [catalog.availableGlyphs, glyphId, newGlyphName, query]);

  const pick = (choice: SwapGlyphChoice) => {
    setOpen(false);
    setQuery("");
    onPick(choice);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content="Add a swap">
        <PopoverTrigger
          ref={panelAnchor.triggerRef}
          render={
            <SidebarActionButton label="Add a swap">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner {...panelAnchor.positioner}>
          <PopoverPopup className="flex h-80 w-60 flex-col overflow-hidden p-0">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>New Swap</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>
            <Autocomplete
              inline
              open
              items={choices}
              filter={null}
              autoHighlight="always"
              itemToStringValue={(choice) => choice.name}
              value={query}
              onValueChange={setQuery}
            >
              <div className="shrink-0 border-b border-line-subtle p-2">
                <AutocompleteInput
                  autoFocus
                  aria-label="Search glyphs"
                  icon={<Search className="h-3 w-3 text-muted" />}
                  iconPosition="left"
                  placeholder="Search"
                />
              </div>
              <AutocompleteEmpty className="flex min-h-0 flex-1 items-center justify-center">
                No matching glyphs
              </AutocompleteEmpty>
              <AutocompleteList className="min-h-0 flex-1 overflow-y-auto">
                {(choice: SwapGlyphChoice) => (
                  <AutocompleteItem
                    key={choice.kind === "create" ? "create" : choice.glyphId}
                    value={choice}
                    className="h-7"
                    onClick={() => pick(choice)}
                  >
                    {choice.kind === "create" ? (
                      <span className="truncate">
                        Create <span className="font-medium">{choice.name}</span>
                      </span>
                    ) : (
                      <span className="truncate">{choice.name}</span>
                    )}
                  </AutocompleteItem>
                )}
              </AutocompleteList>
            </Autocomplete>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};
