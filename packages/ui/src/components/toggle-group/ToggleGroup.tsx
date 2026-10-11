import * as React from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/utils";

export interface ToggleGroupProps extends React.ComponentProps<typeof BaseToggleGroup> {}

/** Row of toggles where, unless `multiple` is set, pressing one releases the others. */
export function ToggleGroup({ className, ...props }: ToggleGroupProps) {
  return <BaseToggleGroup className={cn("flex items-center gap-0.5", className)} {...props} />;
}

export interface ToggleProps extends React.ComponentProps<typeof BaseToggle> {}

/** Icon-sized toggle button: muted until hovered; pressed toggles sit on a filled background. */
export function Toggle({ className, ...props }: ToggleProps) {
  return (
    <BaseToggle
      className={cn(
        "inline-flex size-6 cursor-pointer items-center justify-center rounded text-secondary transition-colors",
        "hover:bg-hover/50 hover:text-primary data-[pressed]:bg-hover data-[pressed]:text-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
