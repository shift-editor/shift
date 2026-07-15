import { Button, cn, type ButtonProps } from "@shift/ui";
import type { ReactNode } from "react";

interface SidebarActionRowProps {
  children: ReactNode;
  actions?: ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
  contentClassName?: string;
}

export const SidebarActionRow = ({
  children,
  actions,
  isActive,
  onClick,
  className,
  contentClassName,
}: SidebarActionRowProps) => (
  <div
    className={cn(
      "group grid min-w-0 w-full grid-cols-[minmax(0,1fr)_1.5rem] items-center rounded transition-colors",
      "hover:bg-hover/50 data-[active]:bg-hover/50",
      className,
    )}
    data-active={isActive ? true : undefined}
  >
    {onClick ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        className={cn(
          "min-w-0 flex-1 justify-start bg-transparent px-2 hover:bg-transparent data-[active]:bg-transparent",
          contentClassName,
        )}
      >
        {children}
      </Button>
    ) : (
      <div className={cn("min-w-0 flex-1 px-2", contentClassName)}>{children}</div>
    )}
    {actions && <SidebarActionSlot>{actions}</SidebarActionSlot>}
  </div>
);

export const SidebarActionSlot = ({ children }: { children?: ReactNode }) => (
  <div className="flex h-full w-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
    {children}
  </div>
);

interface SidebarActionButtonProps extends Omit<ButtonProps, "children" | "size" | "variant"> {
  label: string;
  children: ReactNode;
}

export const SidebarActionButton = ({
  label,
  children,
  className,
  ...props
}: SidebarActionButtonProps) => (
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label={label}
    title={label}
    className={cn("h-6 w-6 p-0.5 text-muted hover:text-primary", className)}
    {...props}
  >
    {children}
  </Button>
);
