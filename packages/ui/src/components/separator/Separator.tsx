import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "../../lib/utils";

export interface SeparatorProps extends React.ComponentProps<typeof BaseSeparator> {
  orientation?: "horizontal" | "vertical";
  /** `subtle` divides panel regions; `strong` stays visible between small controls. */
  variant?: "subtle" | "strong";
}

const variantStyles = {
  subtle: "bg-line-subtle",
  strong: "bg-line/30",
};

export function Separator({
  className,
  orientation = "horizontal",
  variant = "subtle",
  ...props
}: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(
        variantStyles[variant],
        orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
        className,
      )}
      {...props}
    />
  );
}
