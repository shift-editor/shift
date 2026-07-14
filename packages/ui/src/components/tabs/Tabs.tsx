import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import { cn } from "../../lib/utils";

export interface TabsProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.Root> {}

export const Tabs = React.forwardRef<React.ElementRef<typeof BaseTabs.Root>, TabsProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Root ref={ref} className={cn("min-w-0", className)} {...props} />
  ),
);
Tabs.displayName = "Tabs";

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.List> {}

export const TabsList = React.forwardRef<React.ElementRef<typeof BaseTabs.List>, TabsListProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.List
      ref={ref}
      className={cn("relative flex items-center border-b border-line-subtle", className)}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export interface TabsTabProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.Tab> {}

export const TabsTab = React.forwardRef<React.ElementRef<typeof BaseTabs.Tab>, TabsTabProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        "relative h-8 cursor-pointer px-2 text-xs text-secondary outline-none",
        "data-[active]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
        className,
      )}
      {...props}
    />
  ),
);
TabsTab.displayName = "TabsTab";

export interface TabsIndicatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseTabs.Indicator
> {}

export const TabsIndicator = React.forwardRef<
  React.ElementRef<typeof BaseTabs.Indicator>,
  TabsIndicatorProps
>(({ className, ...props }, ref) => (
  <BaseTabs.Indicator
    ref={ref}
    className={cn("absolute bottom-0 h-0.5 bg-accent transition-all", className)}
    {...props}
  />
));
TabsIndicator.displayName = "TabsIndicator";

export interface TabsPanelProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.Panel> {}

export const TabsPanel = React.forwardRef<React.ElementRef<typeof BaseTabs.Panel>, TabsPanelProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Panel ref={ref} className={cn("min-w-0 outline-none", className)} {...props} />
  ),
);
TabsPanel.displayName = "TabsPanel";
