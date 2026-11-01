import * as React from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/utils";

/**
 * `segmented` sets the toggles in a muted track, the pressed one raised on
 * the page background, as a view switcher.
 */
export type ToggleGroupVariant = "default" | "segmented";

export interface ToggleGroupProps extends React.ComponentProps<typeof BaseToggleGroup> {
  variant?: ToggleGroupVariant;
}

const groupVariantStyles: Record<ToggleGroupVariant, string> = {
  default: "",
  segmented: "h-7 rounded-lg bg-surface-muted p-0.5",
};

/** Row of toggles where, unless `multiple` is set, pressing one releases the others. */
export function ToggleGroup({ className, variant = "default", ...props }: ToggleGroupProps) {
  return (
    <BaseToggleGroup
      className={cn("flex items-center gap-0.5", groupVariantStyles[variant], className)}
      {...props}
    />
  );
}

export interface ToggleProps extends React.ComponentProps<typeof BaseToggle> {
  /** Match the {@link ToggleGroup}'s variant. */
  variant?: ToggleGroupVariant;
}

const toggleVariantStyles: Record<ToggleGroupVariant, string> = {
  default:
    "rounded hover:bg-hover/50 hover:text-primary data-[pressed]:bg-hover data-[pressed]:text-primary",
  segmented:
    "rounded-md hover:text-primary data-[pressed]:bg-background data-[pressed]:text-primary data-[pressed]:shadow-xs",
};

/** Icon-sized toggle button: muted until hovered; pressed toggles stand out by variant. */
export function Toggle({ className, variant = "default", ...props }: ToggleProps) {
  return (
    <BaseToggle
      className={cn(
        "inline-flex size-6 cursor-pointer items-center justify-center text-secondary transition-colors",
        toggleVariantStyles[variant],
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
