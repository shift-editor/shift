import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "../../lib/utils";

export type ProgressProps = React.ComponentProps<typeof BaseProgress.Root> & {
  trackClassName?: string;
  indicatorClassName?: string;
};

export function Progress({
  className,
  trackClassName,
  indicatorClassName,
  ...props
}: ProgressProps) {
  return (
    <BaseProgress.Root className={cn("w-full", className)} {...props}>
      <BaseProgress.Track
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-surface-muted",
          trackClassName,
        )}
      >
        <BaseProgress.Indicator
          className={cn("h-full rounded-full bg-accent transition-[width]", indicatorClassName)}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
