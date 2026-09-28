import { useMemo, useRef, useState } from "react";
import type { LanguageScript } from "@shift/glyph-info";
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
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import PlusIcon from "@/assets/general/plus.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { useCheckboxRange } from "@/hooks/useCheckboxRange";
import { ScriptIcon } from "./ScriptIcon";

export interface LanguagePickerProps {
  scripts: readonly LanguageScript[];
  trackedLanguageIds: readonly string[];
  disabled: boolean;
  onApply: (languageIds: readonly string[]) => void;
}

/**
 * Chooses which scripts the sidebar tracks; ticking a script tracks all of its
 * languages. Shift-click applies the clicked row's new state to the range from
 * the last clicked row.
 */
export const LanguagePicker = ({
  scripts,
  trackedLanguageIds,
  disabled,
  onApply,
}: LanguagePickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleScripts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery === ""
      ? scripts
      : scripts.filter(({ script }) => script.toLowerCase().includes(normalizedQuery));
  }, [query, scripts]);

  const { onMouseDown, itemsToChange, resetRange } = useCheckboxRange(visibleScripts);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setQuery("");
      setCheckedIds(new Set(trackedLanguageIds));
      resetRange();
    }
    setOpen(nextOpen);
  };

  const setScriptChecked = (target: LanguageScript, checked: boolean) => {
    const affected = itemsToChange(target);
    setCheckedIds((previous) => {
      const next = new Set(previous);
      for (const script of affected) {
        for (const { language } of script.languages) {
          if (checked) next.add(language.id);
          else next.delete(language.id);
        }
      }
      return next;
    });
  };

  const apply = () => {
    const previous = new Set(trackedLanguageIds);
    onApply([
      ...trackedLanguageIds.filter((languageId) => checkedIds.has(languageId)),
      ...[...checkedIds].filter((languageId) => !previous.has(languageId)),
    ]);
    setOpen(false);
  };

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarActionButton label="Add languages" aria-disabled="true">
            <PlusIcon className="h-3 w-3" />
          </SidebarActionButton>
        </TooltipTrigger>
        <TooltipContent>Add languages</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger
            render={
              <SidebarActionButton label="Add languages">
                <PlusIcon className="h-3 w-3" />
              </SidebarActionButton>
            }
          />
        </TooltipTrigger>
        <TooltipContent>Add languages</TooltipContent>
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner side="right" sideOffset={8} align="start">
          <PopoverPopup className="flex w-64 flex-col p-0" initialFocus={searchRef}>
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>Scripts</PopoverTitle>
              <Tooltip>
                <TooltipTrigger>
                  <PopoverClose variant="icon" aria-label="Close">
                    <X className="h-4 w-4" />
                  </PopoverClose>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>

            <div className="p-2">
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scripts..."
                aria-label="Search scripts"
                size="md"
                icon={<Search className="h-3 w-3 text-muted" />}
                iconPosition="left"
              />
            </div>

            <div
              role="group"
              aria-label="Scripts to track"
              className="scrollbar-themed max-h-80 overflow-y-auto px-2 pb-2"
            >
              {visibleScripts.length === 0 ? (
                <div className="px-1 py-4 text-center text-ui text-muted">No scripts found</div>
              ) : (
                visibleScripts.map((script) => {
                  const trackedCount = script.languages.filter(({ language }) =>
                    checkedIds.has(language.id),
                  ).length;
                  const supportedCount = script.languages.filter(
                    ({ presentCount, requiredCount }) => presentCount === requiredCount,
                  ).length;

                  return (
                    <label
                      key={script.script}
                      className="flex cursor-pointer select-none items-center gap-2 rounded px-1 py-1.5 text-ui text-primary hover:bg-hover"
                      title={`${supportedCount} of ${script.languages.length} languages fully supported`}
                      onMouseDown={onMouseDown}
                    >
                      <Checkbox
                        checked={trackedCount > 0}
                        onCheckedChange={(checked) => setScriptChecked(script, checked)}
                      />
                      <ScriptIcon script={script.script} />
                      <span className="min-w-0 flex-1 truncate">{script.script}</span>
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
