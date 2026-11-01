import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useInlineRename } from "../inline-rename";
import type { SortableItemHandle } from "../sortable-list";
import { Tooltip } from "../tooltip";

export interface DocumentTabsProps extends Omit<
  React.ComponentProps<typeof BaseTabs.Root>,
  "value" | "onValueChange"
> {
  /** The active tab's value; null when no tab is active. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** Names the strip for assistive technology. */
  "aria-label": string;
}

/**
 * A strip of document tabs, as in a browser or an editor's title bar.
 *
 * @remarks
 * Arrow keys move between tabs and Enter opens one; the tabs are navigation,
 * so the strip owns no panels. Fill it with {@link DocumentTab}s and
 * {@link DocumentTabsDivider}s. When space runs short the tabs shrink, their
 * labels ending in an ellipsis, and only below their minimum width does the
 * strip scroll sideways.
 */
export function DocumentTabs({
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className,
  children,
  ...props
}: DocumentTabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className={cn("min-w-0", className)}
      {...props}
    >
      <BaseTabs.List
        aria-label={ariaLabel}
        activateOnFocus={false}
        className="scrollbar-hidden flex min-w-0 items-center gap-0.5 overflow-x-auto"
      >
        {children}
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}

export interface DocumentTabProps extends Omit<
  React.ComponentProps<typeof BaseTabs.Tab>,
  "value" | "children" | "onDoubleClick"
> {
  value: string;
  label: string;
  /** Drawn before the label at 16 × 16, in the title bar's icon colour. */
  icon?: React.ReactNode;
  /** Shows a close button; omit it for a tab that cannot be closed. */
  onClose?: () => void;
  /**
   * Makes the label editable: double-clicking the tab opens a name field, and
   * Enter or leaving it reports the new name. Escape keeps the old one.
   */
  onRename?: (name: string) => void;
  /** Runs on double-click when the tab cannot be renamed. */
  onDoubleClick?: () => void;
  /** Makes the tab reorderable in a `SortableList`: from `useSortableItem` for this tab. */
  sortable?: SortableItemHandle;
}

/** A tab outside a `SortableList`: a frame that never moves and nothing that drags it. */
const NOT_SORTABLE = {
  itemRef: (_element: HTMLElement | null) => undefined,
  itemStyle: undefined,
  activator: undefined,
  dragging: false,
} as const;

/**
 * One tab of a {@link DocumentTabs} strip.
 *
 * @remarks
 * The close button sits beside the tab rather than inside it, so the tab stays
 * one button. It shows while the tab is hovered or focus is in it, and Tab
 * reaches it after its tab. Being active changes the background only, never
 * the text, so tabs keep their width; a long label is cut short with an
 * ellipsis.
 */
export function DocumentTab({
  value,
  label,
  icon,
  onClose,
  onRename,
  onDoubleClick,
  sortable,
  className,
  ...props
}: DocumentTabProps) {
  const tabRef = React.useRef<HTMLDivElement | null>(null);
  // The tab's width when renaming began, so the name field takes its exact place.
  const [renamingWidth, setRenamingWidth] = React.useState<number | null>(null);
  const startRenaming = () => setRenamingWidth(tabRef.current?.offsetWidth ?? null);
  const { itemRef, itemStyle, activator, dragging } = sortable ?? NOT_SORTABLE;
  const setFrame = (element: HTMLDivElement | null) => {
    tabRef.current = element;
    itemRef(element);
  };

  if (renamingWidth !== null && onRename) {
    return (
      <TabNameField
        label={label}
        icon={icon}
        width={renamingWidth}
        onDone={(name) => {
          setRenamingWidth(null);
          if (name !== null) onRename(name);
        }}
      />
    );
  }

  return (
    <div
      ref={setFrame}
      style={itemStyle}
      data-dragging={dragging || undefined}
      className={cn(
        "group/tab relative flex h-7 max-w-48 min-w-16 shrink items-center rounded text-ui text-muted transition-colors data-dragging:z-10 data-dragging:opacity-70",
        "hover:bg-icon-button-hover hover:text-primary has-data-active:bg-surface-hover has-data-active:text-primary has-data-active:shadow-sm",
      )}
    >
      <BaseTabs.Tab
        value={value}
        title={label}
        onDoubleClick={onRename ? startRenaming : onDoubleClick}
        className={cn(
          "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded pl-2 outline-none",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
          onClose ? "pr-1.5" : "pr-2",
          className,
        )}
        {...props}
        {...activator}
      >
        {icon ? <TabIcon>{icon}</TabIcon> : null}
        <span className="min-w-0 truncate">{label}</span>
      </BaseTabs.Tab>
      {onClose ? (
        <Tooltip content="Close tab">
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className={cn(
              "mr-1 flex h-4.5 w-4.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted opacity-0 transition-opacity outline-none",
              "hover:bg-hover hover:text-primary focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent group-focus-within/tab:opacity-100 group-hover/tab:opacity-100",
            )}
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * A tab's name being edited in its place: the tab keeps its icon, size, and
 * position, its label becomes the text field, and a ring marks it.
 */
const TabNameField = ({
  label,
  icon,
  width,
  onDone,
}: {
  label: string;
  icon: React.ReactNode;
  /** The tab's width in pixels, kept while its name is edited. */
  width: number;
  /** Receives the new name, or null when renaming was cancelled. */
  onDone: (name: string | null) => void;
}) => {
  const field = useInlineRename(label, onDone);

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-1.5 rounded bg-surface-hover pr-2 pl-2 text-ui text-primary ring-1 ring-accent ring-inset"
      style={{ width }}
    >
      {icon ? <TabIcon>{icon}</TabIcon> : null}
      <input
        aria-label={`Rename ${label}`}
        className="min-w-0 flex-1 bg-transparent outline-none"
        {...field}
      />
    </div>
  );
};

/** A tab's icon slot, in the title bar's icon colour; primary on the active tab. */
const TabIcon = ({ children }: { children: React.ReactNode }) => (
  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sidebar-icon group-has-data-active/tab:text-primary">
    {children}
  </span>
);

/** A thin rule between groups of tabs, such as a pinned tab and the rest. */
export const DocumentTabsDivider = () => (
  <div aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-control-muted" />
);
