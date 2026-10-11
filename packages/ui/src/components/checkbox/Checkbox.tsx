import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CheckboxProps extends React.ComponentProps<typeof BaseCheckbox.Root> {}

export function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm",
        "border border-line-subtle bg-input text-primary outline-none",
        "focus-visible:ring-1 focus-visible:ring-accent data-[checked]:border-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children ?? (
        <BaseCheckbox.Indicator>
          <Check className="h-3 w-3" strokeWidth={2.5} />
        </BaseCheckbox.Indicator>
      )}
    </BaseCheckbox.Root>
  );
}

export interface CheckboxIndicatorProps extends React.ComponentProps<
  typeof BaseCheckbox.Indicator
> {}

export function CheckboxIndicator({ className, ...props }: CheckboxIndicatorProps) {
  return (
    <BaseCheckbox.Indicator
      className={cn("flex items-center justify-center", className)}
      {...props}
    />
  );
}
