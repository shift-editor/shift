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

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.List> {
  /** `underline` sits on a rule with a {@link TabsIndicator}; `pill` fills the active tab instead. */
  variant?: "underline" | "pill";
}

const listVariantStyles = {
  underline: "border-b border-line-subtle",
  pill: "gap-1",
};

export const TabsList = React.forwardRef<React.ElementRef<typeof BaseTabs.List>, TabsListProps>(
  ({ className, variant = "underline", ...props }, ref) => (
    <BaseTabs.List
      ref={ref}
      className={cn("relative flex items-center", listVariantStyles[variant], className)}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export interface TabsTabProps extends React.ComponentPropsWithoutRef<typeof BaseTabs.Tab> {
  size?: "sm" | "md";
  /** Match the list's variant; `pill` sets its own text size. */
  variant?: "underline" | "pill";
}

const tabSizeStyles = {
  sm: "px-2 text-xs",
  md: "px-2.5 text-sm",
};

const tabVariantStyles = {
  underline: "h-8",
  pill: "h-6 rounded px-2 text-ui hover:text-primary data-[active]:bg-hover",
};

export const TabsTab = React.forwardRef<React.ElementRef<typeof BaseTabs.Tab>, TabsTabProps>(
  ({ className, size = "sm", variant = "underline", ...props }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        "relative cursor-pointer text-secondary outline-none",
        "data-[active]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
        tabSizeStyles[size],
        tabVariantStyles[variant],
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
    className={cn(
      "absolute bottom-0 left-(--active-tab-left) h-0.5",
      "w-(--active-tab-width) bg-accent transition-[left,width]",
      className,
    )}
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
