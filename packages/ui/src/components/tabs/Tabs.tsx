import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "../../lib/utils";

export interface TabsProps extends React.ComponentProps<typeof BaseTabs.Root> {}

export function Tabs({ className, ...props }: TabsProps) {
  return <BaseTabs.Root className={cn("min-w-0", className)} {...props} />;
}

export interface TabsListProps extends React.ComponentProps<typeof BaseTabs.List> {}

export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      className={cn("relative flex items-center border-b border-line-subtle", className)}
      {...props}
    />
  );
}

export interface TabsTabProps extends React.ComponentProps<typeof BaseTabs.Tab> {
  size?: "sm" | "md";
}

const tabSizeStyles = {
  sm: "px-2 text-xs",
  md: "px-2.5 text-sm",
};

export function TabsTab({ className, size = "sm", ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab
      className={cn(
        "relative h-8 cursor-pointer text-secondary outline-none",
        "data-[active]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
        tabSizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}

export interface TabsIndicatorProps extends React.ComponentProps<typeof BaseTabs.Indicator> {}

export function TabsIndicator({ className, ...props }: TabsIndicatorProps) {
  return (
    <BaseTabs.Indicator
      className={cn(
        "absolute bottom-0 left-(--active-tab-left) h-0.5",
        "w-(--active-tab-width) bg-accent transition-[left,width]",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsPanelProps extends React.ComponentProps<typeof BaseTabs.Panel> {}

export function TabsPanel({ className, ...props }: TabsPanelProps) {
  return <BaseTabs.Panel className={cn("min-w-0 outline-none", className)} {...props} />;
}
