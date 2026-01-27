import * as React from "react";
import {
  Button as BaseButton,
  type ButtonProps as BaseButtonProps,
} from "@base-ui-components/react/button";
import { cn } from "../../lib/utils";

export type ButtonProps = BaseButtonProps & {
  variant?: "default" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  isActive?: boolean;
  icon?: React.ReactNode;
};

const variantStyles = {
  default: "bg-surface border border-line-subtle hover:bg-surface-hover",
  ghost: "hover:bg-hover",
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
      icon,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <BaseButton
        ref={ref}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center gap-2 rounded transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
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
  },
);

Button.displayName = "Button";
