import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui-components/react/separator";
import { cn } from "../../lib/utils";

export interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof BaseSeparator> {
  orientation?: "horizontal" | "vertical";
  /** `subtle` divides panel regions; `strong` stays visible between small controls. */
  variant?: "subtle" | "strong";
}

const variantStyles = {
  subtle: "bg-line-subtle",
  strong: "bg-line/30",
};

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", variant = "subtle", ...props }, ref) => {
    return (
      <BaseSeparator
        ref={ref}
        orientation={orientation}
        className={cn(
          variantStyles[variant],
          orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
          className,
        )}
        {...props}
      />
    );
  },
);

Separator.displayName = "Separator";
