import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  Input,
  Popover,
  PopoverPortal,
  PopoverPopup,
  PopoverPositioner,
  PopoverTrigger,
  cn,
} from "@shift/ui";
import CheckIcon from "@/assets/general/check.svg";
import ExpandMoreIcon from "@/assets/general/expand-more.svg";
import SearchIcon from "@/assets/general/search.svg";
import { themeById, type ColorTheme } from "@/lib/themes";

interface ThemePickerProps {
  label: string;
  /** Shift's themes, then theme files, which the list groups under "Your themes". */
  themes: readonly ColorTheme[];
  value: string;
  /** Called with the highlighted theme while the list is open, and `null` when it closes. */
  onPreview: (id: string | null) => void;
  onChoose: (id: string) => void;
}

/**
 * A field that opens a searchable theme list. Arrow keys and hover move the
 * highlight, which the caller previews; Enter or a click chooses, and Escape
 * closes without choosing.
 */
export const ThemePicker = ({ label, themes, value, onPreview, onChoose }: ThemePickerProps) => {
  const listId = useId();
  const optionId = (id: string) => `${listId}-${id}`;
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string>(value);

  const chosen = themeById(value, themes);
  const needle = query.trim().toLowerCase();
  const matching = themes.filter((theme) => theme.name.toLowerCase().includes(needle));
  const builtIn = matching.filter((theme) => !theme.file).sort(compareShipped);
  const yours = matching.filter((theme) => theme.file);
  /** The listed order, which the arrow keys follow. */
  const listed = [...builtIn, ...yours];

  const highlight = (id: string) => {
    setHighlightedId(id);
    onPreview(id);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setQuery("");
    setHighlightedId(value);
    if (!next) onPreview(null);
  };

  const choose = (id: string) => {
    onChoose(id);
    handleOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (listed.length === 0) return;
      const from = listed.findIndex((theme) => theme.id === highlightedId);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = listed[Math.min(listed.length - 1, Math.max(0, from + step))];
      highlight(next.id);
      document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && listed.some((theme) => theme.id === highlightedId)) {
      event.preventDefault();
      choose(highlightedId);
    }
  };

  const renderOption = (theme: ColorTheme) => (
    <div
      key={theme.id}
      id={optionId(theme.id)}
      role="option"
      aria-selected={theme.id === value}
      title={theme.file}
      onMouseEnter={() => highlight(theme.id)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(theme.id)}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded px-2 text-sm text-primary",
        theme.id === highlightedId && "bg-hover",
      )}
    >
      <span className="w-3.5 shrink-0 text-secondary">
        {theme.id === value ? <CheckIcon className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{theme.name}</span>
      <ThemeDots theme={theme} />
    </div>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <div className="w-48">
        <PopoverTrigger
          render={
            <Button variant="default" size="field" aria-label={label}>
              <span className="truncate">{chosen.name}</span>
              <span className="text-muted">
                <ExpandMoreIcon className="h-4 w-4" />
              </span>
            </Button>
          }
        />
      </div>
      <PopoverPortal>
        <PopoverPositioner side="bottom" align="end" sideOffset={4}>
          <PopoverPopup className="flex w-72 flex-col p-0" initialFocus={searchRef}>
            <div className="border-b border-line-subtle p-2">
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search themes…"
                aria-label={`Search ${label.toLowerCase()}s`}
                aria-controls={listId}
                aria-activedescendant={optionId(highlightedId)}
                size="md"
                icon={
                  <span className="text-muted">
                    <SearchIcon className="h-3.5 w-3.5" />
                  </span>
                }
                iconPosition="left"
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={label}
              className="scrollbar-hidden flex max-h-64 flex-col overflow-y-auto p-1"
            >
              {builtIn.map(renderOption)}
              {yours.length > 0 ? (
                <div role="group" aria-label="Your themes" className="flex flex-col">
                  <p className="px-2 pb-1 pt-2 text-ui text-muted">Your themes</p>
                  {yours.map(renderOption)}
                </div>
              ) : null}
              {listed.length === 0 ? (
                <p className="px-2 py-4 text-center text-ui text-muted">No themes found</p>
              ) : null}
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

/** The theme's background, text and accent, then its red and green. */
const ThemeDots = ({ theme }: { theme: ColorTheme }) => {
  const { palette } = theme;
  const colors = [palette.base00, palette.base05, palette.base0D, palette.base08, palette.base0B];

  return (
    <span aria-hidden className="flex shrink-0 -space-x-0.5">
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="size-2.5 rounded-full ring-1 ring-chrome"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
};

/** Shift's own theme first, then the rest by name. */
function compareShipped(a: ColorTheme, b: ColorTheme): number {
  const order = Number(isShiftTheme(b)) - Number(isShiftTheme(a));
  return order || a.name.localeCompare(b.name);
}

function isShiftTheme(theme: ColorTheme): boolean {
  return theme.id === "shift-light" || theme.id === "shift-dark";
}
