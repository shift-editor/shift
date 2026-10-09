import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "../../lib/utils";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof BaseSwitch.Root> {}

export const Switch = React.forwardRef<React.ElementRef<typeof BaseSwitch.Root>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <BaseSwitch.Root
      ref={ref}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "bg-control-muted outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1",
        "data-[checked]:bg-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "h-3 w-3 rounded-full bg-on-accent shadow-sm transition-transform",
          "data-[checked]:translate-x-3",
        )}
      />
    </BaseSwitch.Root>
  ),
);
Switch.displayName = "Switch";
