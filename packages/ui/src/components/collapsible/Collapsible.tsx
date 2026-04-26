import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui-components/react/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CollapsibleProps extends React.ComponentProps<typeof BaseCollapsible.Root> {}

export const Collapsible = (props: CollapsibleProps) => <BaseCollapsible.Root {...props} />;

export interface CollapsibleTriggerProps extends React.ComponentPropsWithoutRef<
  typeof BaseCollapsible.Trigger
> {}

export const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof BaseCollapsible.Trigger>,
  CollapsibleTriggerProps
>(({ className, ...props }, ref) => (
  <BaseCollapsible.Trigger ref={ref} className={cn("group", className)} {...props} />
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export interface CollapsiblePanelProps extends React.ComponentPropsWithoutRef<
  typeof BaseCollapsible.Panel
> {}

export const CollapsiblePanel = React.forwardRef<
  React.ElementRef<typeof BaseCollapsible.Panel>,
  CollapsiblePanelProps
>(({ className, ...props }, ref) => (
  <BaseCollapsible.Panel ref={ref} className={cn(className)} {...props} />
));
CollapsiblePanel.displayName = "CollapsiblePanel";

export interface CollapsibleChevronProps extends React.ComponentPropsWithoutRef<"svg"> {}

export const CollapsibleChevron = ({ className, ...props }: CollapsibleChevronProps) => (
  <ChevronRight
    className={cn(
      "w-3 h-3 transition-transform duration-150 group-data-[panel-open]:rotate-90",
      className,
    )}
    {...props}
  />
);
