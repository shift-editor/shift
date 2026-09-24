import * as React from "react";
import { Input as BaseInput } from "@base-ui-components/react/input";
import { cn } from "../../lib/utils";

export interface InputProps extends Omit<React.ComponentProps<typeof BaseInput>, "size"> {
  size?: "compact" | "sm" | "md";
  variant?: "filled" | "plain";
  label?: React.ReactNode;
  labelPosition?: "left" | "right";
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

const sizeStyles = {
  compact: "h-6 text-ui",
  sm: "h-7 text-xs",
  md: "h-8 text-sm",
};

const variantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

type InputKeyDownEvent = Parameters<NonNullable<InputProps["onKeyDown"]>>[0];

function isSelectAllShortcut(event: InputKeyDownEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      size = "compact",
      variant = "filled",
      label,
      labelPosition = "left",
      icon,
      iconPosition = "right",
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const iconOnLeft = iconPosition === "left";
    const labelOnRight = labelPosition === "right";

    const handleKeyDown: InputProps["onKeyDown"] = (event) => {
      if (onKeyDown) onKeyDown(event);
      if (event.defaultPrevented) return;

      if (isSelectAllShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.select();
      }
    };

    return (
      <div className="relative flex min-w-0 w-full items-center">
        {label && (
          <span
            className={cn(
              "absolute text-muted text-ui font-medium pointer-events-none",
              labelOnRight ? "right-2" : "left-2",
            )}
          >
            {label}
          </span>
        )}
        {icon && iconOnLeft && <span className="absolute left-2 pointer-events-none">{icon}</span>}
        <BaseInput
          ref={ref}
          className={cn(
            "w-full rounded px-2 text-primary",
            "focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent",
            sizeStyles[size],
            variantStyles[variant],
            "disabled:opacity-50 disabled:cursor-not-allowed",
            label && !labelOnRight && "pl-6",
            label && labelOnRight && "pr-6",
            icon && iconOnLeft && "pl-6",
            icon && !iconOnLeft && "pr-6",
            className,
          )}
          onKeyDown={handleKeyDown}
          {...props}
        />
        {icon && !iconOnLeft && (
          <span className="absolute right-2 pointer-events-none">{icon}</span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
