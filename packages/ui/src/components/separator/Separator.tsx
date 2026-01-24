import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui-components/react/separator";
import { cn } from "../../lib/utils";

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<typeof BaseSeparator> {
  orientation?: "horizontal" | "vertical";
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", ...props }, ref) => {
    return (
      <BaseSeparator
        ref={ref}
        orientation={orientation}
        className={cn(
          "bg-line-subtle",
          orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
          className,
        )}
        {...props}
      />
    );
  },
);

Separator.displayName = "Separator";
