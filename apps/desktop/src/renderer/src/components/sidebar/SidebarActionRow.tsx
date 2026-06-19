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
  <div className={cn("group flex min-w-0 items-center gap-1 w-full", className)}>
    {onClick ? (
      <Button
        variant="ghost"
        size="sm"
        isActive={isActive}
        onClick={onClick}
        className={cn("min-w-0 flex-1 justify-start px-2", contentClassName)}
      >
        {children}
      </Button>
    ) : (
      <div className={cn("min-w-0 flex-1 px-2", contentClassName)}>{children}</div>
    )}
    {actions && (
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </div>
    )}
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
    className={cn("h-6 w-6 text-muted hover:text-primary", className)}
    {...props}
  >
    {children}
  </Button>
);
