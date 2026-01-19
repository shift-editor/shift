import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  variant?: "default" | "ghost" | "toolbar";
  size?: "sm" | "md" | "lg" | "icon";
  isActive?: boolean;
  icon?: React.ReactNode;
}

const variantStyles = {
  default: "bg-surface border border-line-subtle hover:bg-surface-hover",
  ghost: "hover:bg-surface-hover",
  toolbar: "hover:bg-toolbar-hover",
};

const sizeStyles = {
  sm: "h-7 px-2 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
  icon: "h-8 w-8 p-1",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      isActive,
      disabled,
      icon,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          "disabled:pointer-events-none disabled:opacity-50",
          variantStyles[variant],
          sizeStyles[size],
          className,
          "data-[active=true]:bg-toolbar-hover",
        )}
        disabled={disabled}
        data-active={isActive ? true : undefined}
        {...props}
      >
        {icon}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
