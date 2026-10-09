import * as React from "react";
import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { cn } from "../../lib/utils";

export type RadioGroupProps = React.ComponentProps<typeof BaseRadioGroup>;

export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return <BaseRadioGroup className={cn("gap-2", className)} {...props} />;
}

export type RadioCardProps = React.ComponentProps<typeof BaseRadio.Root>;

export function RadioCard({ className, ...props }: RadioCardProps) {
  return (
    <BaseRadio.Root
      className={cn(
        "flex h-12 cursor-pointer items-center justify-between gap-2 rounded-sm border border-transparent px-2 text-sm font-normal",
        "transition-colors duration-200 hover:bg-hover/50 data-[checked]:border-accent data-[checked]:bg-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
