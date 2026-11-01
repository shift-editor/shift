import { useMemo, useRef, useState } from "react";
import type { PickerChoice, PickerRow } from "@/types/sidebarPicker";
import {
  Button,
  Check,
  ChevronDown,
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
  cn,
} from "@shift/ui";
import { useSidebarBlock } from "./SidebarGroup";

interface SidebarPickerProps {
  /** Names the setting: the trigger's accessible name and the panel's title. */
  readonly label: string;
  /** The current choice's label, shown on the trigger. */
  readonly value: string;
  /** Whether nothing is chosen; the trigger shows `value` muted. */
  readonly unset: boolean;
  /** The panel, mounted only while open so its choices are built only then. */
  readonly panel: (close: () => void) => React.ReactNode;
}

/**
 * A sidebar setting whose value opens a panel beside the sidebar, as the
 * kerning group field does: the trigger is the value and a chevron.
 */
export function SidebarPicker({ label, value, unset, panel }: SidebarPickerProps) {
  const [open, setOpen] = useState(false);
  const block = useSidebarBlock();

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isActive={open}
            aria-label={label}
            className="-mr-2 h-6 min-w-0"
          >
            <span className={cn("truncate text-ui", unset ? "text-secondary" : "text-primary")}>
              {value}
            </span>
            <span className="flex shrink-0 text-muted">
              <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
            </span>
          </Button>
        }
      />
      <PopoverPortal>
        {/* Beside the sidebar like its other panels: right border over the sidebar's, top on the divider above the field's block. */}
        <PopoverPositioner
          anchor={block}
          side="left"
          align="start"
          sideOffset={-1}
          alignOffset={-1}
        >
          {open ? panel(() => setOpen(false)) : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}

interface PickerPanelProps {
  readonly title: string;
  readonly searchLabel: string;
  readonly choices: readonly PickerChoice[];
  /** The chosen key; null when the setting is unset. */
  readonly current: string | null;
  /** The label of the row that unsets the setting, listed first while not searching. */
  readonly noneLabel: string;
  readonly onPick: (key: string | null) => void;
}

/** The panel of a {@link SidebarPicker}: title and close, a search, then the choices. */
export function PickerPanel({
  title,
  searchLabel,
  choices,
  current,
  noneLabel,
  onPick,
}: PickerPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const needle = query.trim().toLowerCase();
  const rows = useMemo<readonly PickerRow[]>(() => {
    if (!needle) return [{ key: null, label: noneLabel }, ...choices];
    return choices.filter(
      (choice) =>
        choice.label.toLowerCase().includes(needle) ||
        (choice.detail?.toLowerCase().includes(needle) ?? false),
    );
  }, [choices, needle, noneLabel]);

  return (
    <PopoverPopup className="flex w-60 flex-col p-0" initialFocus={searchRef}>
      <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pl-2 pr-1">
        <PopoverTitle>{title}</PopoverTitle>
        <Tooltip content="Close">
          <PopoverClose variant="icon" aria-label="Close">
            <X className="h-4 w-4" />
          </PopoverClose>
        </Tooltip>
      </div>
      <div className="border-b border-line-subtle p-2">
        <Input
          ref={searchRef}
          aria-label={searchLabel}
          icon={<Search className="h-3 w-3 text-muted" />}
          iconPosition="left"
          placeholder="Search"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowDown":
              case "ArrowUp": {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlighted((index) => Math.min(Math.max(index + step, 0), rows.length - 1));
                return;
              }
              case "Enter": {
                event.preventDefault();
                const row = rows[highlighted];
                if (row) onPick(row.key);
              }
            }
          }}
        />
      </div>
      {rows.length === 0 ? (
        <p className="flex h-16 items-center justify-center text-ui text-secondary">No matches</p>
      ) : (
        <ul
          role="listbox"
          aria-label={title}
          className="scrollbar-hidden max-h-72 overflow-y-auto p-1"
        >
          {rows.map((row, index) => {
            const { key } = row;
            return (
              <li key={key ?? "none"} role="option" aria-selected={key === current}>
                <Button
                  type="button"
                  variant="row"
                  isActive={index === highlighted}
                  className="h-7"
                  onPointerEnter={() => setHighlighted(index)}
                  onClick={() => onPick(key)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="flex w-3 shrink-0 justify-center">
                      {key === current ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className={cn("truncate", key === null && "text-muted")}>
                      {row.label}
                    </span>
                    {row.detail ? (
                      <span className="ml-auto shrink-0 text-muted">{row.detail}</span>
                    ) : null}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </PopoverPopup>
  );
}
