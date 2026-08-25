import * as React from "react";
import { Progress as BaseProgress } from "@base-ui-components/react/progress";
import { cn } from "../../lib/utils";

export type ProgressProps = React.ComponentPropsWithoutRef<typeof BaseProgress.Root> & {
  trackClassName?: string;
  indicatorClassName?: string;
};

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, trackClassName, indicatorClassName, ...props }, ref) => (
    <BaseProgress.Root ref={ref} className={cn("w-full", className)} {...props}>
      <BaseProgress.Track
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-canvas", trackClassName)}
      >
        <BaseProgress.Indicator
          className={cn("h-full rounded-full bg-accent transition-[width]", indicatorClassName)}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  ),
);

Progress.displayName = "Progress";
