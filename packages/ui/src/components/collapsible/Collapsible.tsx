import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CollapsibleProps extends React.ComponentProps<typeof BaseCollapsible.Root> {}

export const Collapsible = (props: CollapsibleProps) => <BaseCollapsible.Root {...props} />;

export interface CollapsibleTriggerProps extends React.ComponentProps<
  typeof BaseCollapsible.Trigger
> {}

export function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
  return <BaseCollapsible.Trigger className={cn("group", className)} {...props} />;
}

export interface CollapsiblePanelProps extends React.ComponentProps<typeof BaseCollapsible.Panel> {}

export function CollapsiblePanel({ className, ...props }: CollapsiblePanelProps) {
  return <BaseCollapsible.Panel className={cn(className)} {...props} />;
}

export interface CollapsibleChevronProps extends React.ComponentProps<"svg"> {}

export const CollapsibleChevron = ({ className, ...props }: CollapsibleChevronProps) => (
  <ChevronRight
    className={cn(
      "w-3 h-3 transition-transform duration-150 group-data-[panel-open]:rotate-90",
      className,
    )}
    {...props}
  />
);
