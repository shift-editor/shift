import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui-components/react/collapsible";
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
  <BaseCollapsible.Trigger ref={ref} className={cn(className)} {...props} />
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
