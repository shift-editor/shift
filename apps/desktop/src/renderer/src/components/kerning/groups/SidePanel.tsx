import { Button, Input, Search, Tooltip, TooltipContent, TooltipTrigger, X } from "@shift/ui";

interface SidePanelProps {
  readonly title: string;
  /** What the search field searches, for its label and placeholder. */
  readonly searchLabel: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/**
 * A searchable list beside the groups panel's left side, its top level with
 * the panel's: a title and a search field, each above a rule, then the list.
 *
 * @remarks
 * Part of the groups panel rather than a popover of its own, so the two
 * line up exactly and clicks in it never count as outside the panel.
 */
export function SidePanel({
  title,
  searchLabel,
  query,
  onQueryChange,
  onClose,
  children,
}: SidePanelProps) {
  return (
    <section
      aria-label={title}
      className="absolute -top-px right-full flex w-60 flex-col rounded-md border border-line-subtle bg-surface shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
        <h2 className="truncate text-ui font-medium text-primary">{title}</h2>
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
      <div className="border-b border-line-subtle p-2">
        <Input
          autoFocus
          aria-label={searchLabel}
          icon={<Search className="h-3 w-3 text-muted" />}
          iconPosition="left"
          placeholder={searchLabel}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </div>
      <div className="scrollbar-hidden max-h-72 overflow-y-auto p-1">{children}</div>
    </section>
  );
}
