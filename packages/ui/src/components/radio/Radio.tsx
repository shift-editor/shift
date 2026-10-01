import * as React from "react";
import { Radio as BaseRadio } from "@base-ui-components/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import { cn } from "../../lib/utils";

export type RadioGroupProps = React.ComponentPropsWithoutRef<typeof BaseRadioGroup>;

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof BaseRadioGroup>,
  RadioGroupProps
>(({ className, ...props }, ref) => (
  <BaseRadioGroup ref={ref} className={cn("gap-2", className)} {...props} />
));

RadioGroup.displayName = "RadioGroup";

export type RadioCardProps = React.ComponentPropsWithoutRef<typeof BaseRadio.Root>;

export const RadioCard = React.forwardRef<React.ElementRef<typeof BaseRadio.Root>, RadioCardProps>(
  ({ className, ...props }, ref) => (
    <BaseRadio.Root
      ref={ref}
      className={cn(
        "flex h-12 cursor-pointer items-center justify-between gap-2 rounded-sm border border-transparent px-2 text-sm font-normal",
        "transition-colors duration-200 hover:bg-hover/50 data-[checked]:border-accent data-[checked]:bg-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);

RadioCard.displayName = "RadioCard";
