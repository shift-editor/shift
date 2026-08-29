import * as React from "react";
import { Toolbar as BaseToolbar } from "@base-ui-components/react/toolbar";
import { cn } from "../../lib/utils";

export interface ToolbarProps extends React.ComponentPropsWithoutRef<typeof BaseToolbar.Root> {}

export const Toolbar = React.forwardRef<React.ElementRef<typeof BaseToolbar.Root>, ToolbarProps>(
  ({ className, ...props }, ref) => (
    <BaseToolbar.Root ref={ref} className={cn(className)} {...props} />
  ),
);
Toolbar.displayName = "Toolbar";

export interface ToolbarGroupProps extends React.ComponentPropsWithoutRef<
  typeof BaseToolbar.Group
> {}

export const ToolbarGroup = React.forwardRef<
  React.ElementRef<typeof BaseToolbar.Group>,
  ToolbarGroupProps
>(({ className, ...props }, ref) => (
  <BaseToolbar.Group ref={ref} className={cn(className)} {...props} />
));
ToolbarGroup.displayName = "ToolbarGroup";

export interface ToolbarButtonProps extends React.ComponentPropsWithoutRef<
  typeof BaseToolbar.Button
> {}

export const ToolbarButton = React.forwardRef<
  React.ElementRef<typeof BaseToolbar.Button>,
  ToolbarButtonProps
>(({ className, ...props }, ref) => (
  <BaseToolbar.Button ref={ref} className={cn(className)} {...props} />
));
ToolbarButton.displayName = "ToolbarButton";

export interface ToolbarSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseToolbar.Separator
> {}

export const ToolbarSeparator = React.forwardRef<
  React.ElementRef<typeof BaseToolbar.Separator>,
  ToolbarSeparatorProps
>(({ className, ...props }, ref) => (
  <BaseToolbar.Separator
    ref={ref}
    className={cn("h-5 w-px shrink-0 bg-line-subtle", className)}
    {...props}
  />
));
ToolbarSeparator.displayName = "ToolbarSeparator";
