import * as React from "react";
import { Button as BaseButton, type ButtonProps as BaseButtonProps } from "@base-ui/react/button";
import { cn } from "../../lib/utils";

export type ButtonProps = BaseButtonProps & {
  variant?:
    | "default"
    | "ghost"
    | "primary"
    | "outline"
    | "toolbar"
    | "row"
    | "muted"
    | "transparent"
    | "field"
    | "inverse";
  size?: "sm" | "md" | "lg" | "action" | "prompt" | "icon" | "icon-sm" | "field";
  isActive?: boolean;
  icon?: React.ReactNode;
};

const variantStyles = {
  primary: "rounded-md bg-accent text-on-accent hover:bg-accent/90",
  default: "border border-line-subtle bg-background hover:bg-surface-hover",
  /** A secondary action beside a primary one: no fill, a hairline drawn inside its edge. */
  outline: "text-primary ring-1 ring-chrome ring-inset hover:bg-hover/50",
  ghost: "hover:bg-hover/50 data-[active]:bg-hover/50",
  toolbar:
    "text-sidebar-icon hover:bg-icon-button-hover data-[active]:bg-transparent data-[active]:text-accent data-[active]:hover:bg-icon-button-hover",
  row: "w-full justify-start rounded-sm px-2 text-sm font-normal hover:bg-hover/50 data-[active]:bg-hover data-[active]:hover:bg-hover",
  muted: "text-muted hover:bg-hover/50 hover:text-primary",
  transparent: "bg-transparent hover:bg-transparent data-[active]:bg-transparent",
  /**
   * A field that opens something, such as a list beside it: a shade lighter
   * than a text input's fill, with a hairline border, so it reads apart.
   */
  field:
    "rounded border border-line-subtle bg-surface-muted font-normal text-primary hover:bg-input data-[active]:border-accent",
  /** A quiet action on an inverse surface, such as Later on the dark update strip. */
  inverse:
    "text-on-surface-inverse/60 hover:bg-on-surface-inverse/10 hover:text-on-surface-inverse",
};

const sizeStyles = {
  sm: "h-7 px-2 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
  /** A page's main actions, with room for a shortcut after the label. */
  action: "h-7.5 gap-2.5 rounded-lg pr-2.5 pl-3 text-label font-medium",
  /** The actions of a one-line prompt, such as the update strip's Download and Later. */
  prompt: "h-7 rounded-lg px-3 text-sm font-medium",
  icon: "h-8 w-8 p-1",
  "icon-sm": "h-6 w-6 p-0.5",
  field: "h-7 w-full justify-between px-2 text-ui",
};

export function Button({
  className,
  variant = "default",
  size = "md",
  isActive,
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "aria-disabled:cursor-default aria-disabled:opacity-50",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      data-active={isActive ? true : undefined}
      {...props}
    >
      {icon}
      {children}
    </BaseButton>
  );
}
