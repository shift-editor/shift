import * as React from "react";
import { Toggle as BaseToggle } from "@base-ui-components/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui-components/react/toggle-group";
import { cn } from "../../lib/utils";

export interface ToggleGroupProps extends React.ComponentPropsWithoutRef<typeof BaseToggleGroup> {}

/** Row of toggles where, unless `multiple` is set, pressing one releases the others. */
export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof BaseToggleGroup>,
  ToggleGroupProps
>(({ className, ...props }, ref) => (
  <BaseToggleGroup ref={ref} className={cn("flex items-center gap-0.5", className)} {...props} />
));
ToggleGroup.displayName = "ToggleGroup";

export interface ToggleProps extends React.ComponentPropsWithoutRef<typeof BaseToggle> {}

/** Icon-sized toggle button: muted until hovered; pressed toggles sit on a filled background. */
export const Toggle = React.forwardRef<React.ElementRef<typeof BaseToggle>, ToggleProps>(
  ({ className, ...props }, ref) => (
    <BaseToggle
      ref={ref}
      className={cn(
        "inline-flex size-6 cursor-pointer items-center justify-center rounded text-secondary transition-colors",
        "hover:bg-hover/50 hover:text-primary data-[pressed]:bg-hover data-[pressed]:text-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Toggle.displayName = "Toggle";
