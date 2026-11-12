import { useMemo, useRef, useState } from "react";
import type { LanguageCoverage, LanguageScript } from "@shift/glyph-info";
import {
  Button,
  Checkbox,
  Input,
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
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { SidebarActionButton } from "@/components/sidebar";
import { useCheckboxRange } from "@/hooks/useCheckboxRange";
import { NameQuery } from "@/lib/utils/NameQuery";
import { useMemberSet } from "@/hooks/useMemberSet";
import { languageTooltip, listedIds, listedLanguages, searchableNames } from "./languageText";

export interface ScriptLanguagePickerProps {
  /** Every language written in the script, tracked or not. */
  script: LanguageScript;
  trackedLanguageIds: readonly string[];
  disabled: boolean;
  onApply: (languageIds: readonly string[]) => void;
}

/**
 * Chooses which of one script's languages the sidebar tracks, such as adding
 * Iranian Persian beside Standard Arabic. Searches names and autonyms;
 * shift-click applies the clicked row's new state to the range from the last
 * clicked row. Languages of other scripts stay as they are.
 */
export const ScriptLanguagePicker = ({
  script,
  trackedLanguageIds,
  disabled,
  onApply,
}: ScriptLanguagePickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const checked = useMemberSet<string>();
  const checkedIds = checked.values;
  const searchRef = useRef<HTMLInputElement>(null);
  const label = `Add ${script.script} languages`;

  // Folded languages are found through the language covering them: "Indonesian" finds Malaysian.
  const listed = useMemo(() => listedLanguages(script), [script]);
  const visibleLanguages = useMemo(() => {
    const search = NameQuery.from(query);
    return search.isEmpty ? listed : search.filterBy(listed, searchableNames);
  }, [listed, query]);

  const { onMouseDown, itemsToChange, resetRange } = useCheckboxRange(visibleLanguages);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setQuery("");
      checked.clear();
      checked.setMany(listedIds([script], trackedLanguageIds), true);
      resetRange();
    }
    setOpen(nextOpen);
  };

  const setLanguageChecked = (target: LanguageCoverage, isChecked: boolean) => {
    checked.setMany(
      itemsToChange(target).map(({ language }) => language.id),
      isChecked,
    );
  };

  const apply = () => {
    const scriptIds = new Set(script.languages.map(({ language }) => language.id));
    const kept = listedIds([script], trackedLanguageIds).filter((id) => checkedIds.has(id));
    const added = listed
      .map(({ language }) => language.id)
      .filter((id) => checkedIds.has(id) && !kept.includes(id));
    onApply([...trackedLanguageIds.filter((id) => !scriptIds.has(id)), ...kept, ...added]);
    setOpen(false);
  };

  const panelAnchor = useSidebarPanelAnchor();

  if (disabled) {
    return (
      <Tooltip content={label}>
        <SidebarActionButton label={label} aria-disabled="true">
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip content={label}>
        <PopoverTrigger
          ref={panelAnchor.triggerRef}
          render={
            <SidebarActionButton label={label}>
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner {...panelAnchor.positioner}>
          <PopoverPopup className="flex w-64 flex-col p-0" initialFocus={searchRef}>
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>{script.script} Languages</PopoverTitle>
              <Tooltip content="Close">
                <PopoverClose variant="icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </PopoverClose>
              </Tooltip>
            </div>

            <div className="p-2">
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search languages..."
                aria-label="Search languages"
                size="md"
                icon={<Search className="h-3 w-3 text-muted" />}
                iconPosition="left"
              />
            </div>

            <div
              role="group"
              aria-label={`${script.script} languages to track`}
              className="max-h-80 overflow-y-auto px-2 pb-2"
            >
              {visibleLanguages.length === 0 ? (
                <div className="px-1 py-4 text-center text-ui text-muted">No languages found</div>
              ) : (
                visibleLanguages.map((coverage) => {
                  const { language, fullPresentCount, fullRequiredCount } = coverage;

                  return (
                    <label
                      key={language.id}
                      className="flex cursor-pointer select-none items-center gap-2 rounded px-1 py-1.5 text-ui text-primary hover:bg-hover"
                      title={languageTooltip(coverage)}
                      onMouseDown={onMouseDown}
                    >
                      <Checkbox
                        checked={checkedIds.has(language.id)}
                        onCheckedChange={(isChecked) => setLanguageChecked(coverage, isChecked)}
                      />
                      <span className="min-w-0 flex-1 truncate">{language.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {fullPresentCount}/{fullRequiredCount}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-line-subtle p-2">
              <PopoverClose
                render={
                  <Button type="button" className="h-7.5 text-ui">
                    Cancel
                  </Button>
                }
              />
              <Button type="button" variant="primary" className="h-7.5 text-ui" onClick={apply}>
                Done
              </Button>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};
