import { Button, cn, type ButtonProps, type SortableActivatorProps } from "@shift/ui";
import { forwardRef, type KeyboardEventHandler, type MouseEvent, type ReactNode } from "react";
import { SidebarRowButton } from "./SidebarRowButton";

export interface SidebarActionRowProps {
  children: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  isActive?: boolean;
  isSelected?: boolean;
  joinsPrevious?: boolean;
  joinsNext?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  className?: string;
  contentClassName?: string;
  tabIndex?: number;
  "data-testid"?: string;
  /** Makes the row's button drag the row in a `SortableList` (`useSortableItem(id).activator`). */
  activator?: SortableActivatorProps;
}

export const SidebarActionRow = ({
  children,
  leading,
  actions,
  isActive,
  isSelected,
  joinsPrevious,
  joinsNext,
  onClick,
  onDoubleClick,
  onKeyDown,
  className,
  contentClassName,
  tabIndex,
  "data-testid": testId,
  activator,
}: SidebarActionRowProps) => (
  <div
    className={cn(
      "group gap-0.5 flex h-7 w-full min-w-0 items-center rounded transition-colors",
      "hover:bg-hover/50 data-[active]:bg-hover",
      isSelected &&
        "relative isolate bg-transparent before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded before:bg-hover/50 before:content-['']",
      joinsPrevious && "before:-top-1 before:rounded-t-none",
      joinsNext && "before:rounded-b-none",
      className,
    )}
    data-active={isActive ? true : undefined}
    data-selected={isSelected ? true : undefined}
  >
    {leading}
    {onClick ? (
      <SidebarRowButton
        variant="transparent"
        {...activator}
        data-testid={testId}
        tabIndex={tabIndex}
        aria-pressed={isSelected}
        onPointerDown={(event) => {
          event.currentTarget.dataset.pointerFocus = "true";
          if (activator?.onPointerDown) activator.onPointerDown(event);
        }}
        onBlur={(event) => {
          delete event.currentTarget.dataset.pointerFocus;
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={(event) => {
          if (onKeyDown) onKeyDown(event);
          if (activator?.onKeyDown) activator.onKeyDown(event);
        }}
        className={cn("w-auto flex-1 data-[pointer-focus]:focus-visible:ring-0", contentClassName)}
      >
        {children}
      </SidebarRowButton>
    ) : (
      <div
        data-testid={testId}
        className={cn("flex h-7 min-w-0 flex-1 items-center px-2 text-ui", contentClassName)}
      >
        {children}
      </div>
    )}
    {actions && <SidebarActionSlot>{actions}</SidebarActionSlot>}
  </div>
);

export const SidebarActionSlot = ({
  children,
  isVisible,
}: {
  children?: ReactNode;
  isVisible?: boolean;
}) => (
  <div
    className={cn(
      "flex h-full min-w-6 shrink-0 items-center justify-center",
      "[&>*]:opacity-0 [&>*]:transition-opacity group-hover:[&>*]:opacity-100",
      "[&>*:focus-visible]:opacity-100",
      "[&>*[aria-disabled]]:!opacity-0 group-hover:[&>*[aria-disabled]]:!opacity-50",
      "[&>*[aria-disabled]:focus-visible]:!opacity-50",
      isVisible && "[&>*]:opacity-100",
    )}
  >
    {children}
  </div>
);

export interface SidebarActionButtonProps extends Omit<
  ButtonProps,
  "children" | "size" | "variant"
> {
  label: string;
  children: ReactNode;
}

export const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  ({ label, children, className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="muted"
      size="icon-sm"
      aria-label={label}
      className={className}
      {...props}
    >
      {children}
    </Button>
  ),
);

SidebarActionButton.displayName = "SidebarActionButton";
