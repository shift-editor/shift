import * as React from "react";
import { Input as BaseInput } from "@base-ui-components/react/input";
import { cn } from "../../lib/utils";

export interface InputProps extends React.ComponentProps<typeof BaseInput> {
  label?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, icon, iconPosition = "right", ...props }, ref) => {
    const iconOnLeft = iconPosition === "left";

    return (
      <div className="relative flex items-center">
        {label && (
          <span className="absolute left-2 text-muted text-[9px] font-medium pointer-events-none">
            {label}
          </span>
        )}
        {icon && iconOnLeft && <span className="absolute left-2 pointer-events-none">{icon}</span>}
        <BaseInput
          ref={ref}
          className={cn(
            "w-full h-6 px-2 text-[9px] text-primary bg-input rounded",
            "focus:outline-none focus:ring-1 focus:ring-accent",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            label && "pl-5",
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
