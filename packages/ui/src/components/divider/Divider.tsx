import * as React from "react";
import { cn } from "../../lib/utils";

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ className, orientation = "horizontal", ...props }, ref) => {
    return (
      <div
        ref={ref}
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

Divider.displayName = "Divider";
