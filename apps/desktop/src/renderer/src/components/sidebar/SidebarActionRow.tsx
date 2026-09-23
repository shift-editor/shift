import { Button, cn, type ButtonProps } from "@shift/ui";
import { forwardRef, type MouseEvent, type ReactNode } from "react";
import { SidebarRowButton } from "./SidebarRowButton";

interface SidebarActionRowProps {
  children: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  isActive?: boolean;
  isSelected?: boolean;
  joinsPrevious?: boolean;
  joinsNext?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
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
  className,
  contentClassName,
  "data-testid": testId,
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
          "w-auto flex-1 bg-transparent hover:bg-transparent data-[pointer-focus]:focus-visible:ring-0 data-[active]:bg-transparent",
          contentClassName,
        )}
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
