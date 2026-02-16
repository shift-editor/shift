import * as React from "react";
import { Input as BaseInput } from "@base-ui-components/react/input";
import { cn } from "../../lib/utils";

export interface InputProps extends React.ComponentProps<typeof BaseInput> {
  label?: React.ReactNode;
  labelPosition?: "left" | "right";
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, labelPosition = "left", icon, iconPosition = "right", ...props }, ref) => {
    const iconOnLeft = iconPosition === "left";
    const labelOnRight = labelPosition === "right";

    return (
      <div className="relative flex items-center">
        {label && (
          <span
            className={cn(
              "absolute text-muted text-[11px] font-medium pointer-events-none",
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
            "w-full h-6 px-2 text-[11px] text-primary bg-input rounded",
            "focus:outline-none focus:ring-1 focus:ring-accent",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            label && !labelOnRight && "pl-5",
            label && labelOnRight && "pr-5",
            icon && iconOnLeft && "pl-6",
            icon && !iconOnLeft && "pr-6",
            className,
          )}
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
