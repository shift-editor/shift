import { Button, cn, type ButtonProps } from "@shift/ui";
import { forwardRef, type MouseEvent, type ReactNode } from "react";

interface SidebarActionRowProps {
  children: ReactNode;
  actions?: ReactNode;
  isActive?: boolean;
  isSelected?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
}

export const SidebarActionRow = ({
  children,
  actions,
  isActive,
  isSelected,
  onClick,
  className,
  contentClassName,
  "data-testid": testId,
}: SidebarActionRowProps) => (
  <div
    className={cn(
      "group grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded transition-colors",
      "hover:bg-hover/50 data-[selected]:bg-hover/50 data-[active]:bg-hover",
      className,
    )}
    data-active={isActive ? true : undefined}
    data-selected={isSelected ? true : undefined}
  >
    {onClick ? (
      <Button
        variant="ghost"
        size="sm"
        data-testid={testId}
        aria-pressed={isSelected}
        onPointerDown={(event) => {
          event.currentTarget.dataset.pointerFocus = "true";
        }}
        onBlur={(event) => {
          delete event.currentTarget.dataset.pointerFocus;
        }}
        onClick={onClick}
        className={cn(
          "min-w-0 flex-1 justify-start bg-transparent px-2 hover:bg-transparent data-[pointer-focus]:focus-visible:ring-0 data-[active]:bg-transparent",
          contentClassName,
        )}
      >
        {children}
      </Button>
    ) : (
      <div data-testid={testId} className={cn("min-w-0 flex-1 px-2", contentClassName)}>
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

interface SidebarActionButtonProps extends Omit<ButtonProps, "children" | "size" | "variant"> {
  label: string;
  children: ReactNode;
}

export const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  ({ label, children, className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={cn("h-6 w-6 p-0.5 text-muted hover:text-primary", className)}
      {...props}
    >
      {children}
    </Button>
  ),
);

SidebarActionButton.displayName = "SidebarActionButton";
