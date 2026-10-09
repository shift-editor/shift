import * as React from "react";
import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import { cn } from "../../lib/utils";

export interface ToolbarProps extends React.ComponentProps<typeof BaseToolbar.Root> {}

export function Toolbar({ className, ...props }: ToolbarProps) {
  return <BaseToolbar.Root className={cn(className)} {...props} />;
}

export interface ToolbarGroupProps extends React.ComponentProps<typeof BaseToolbar.Group> {}

export function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return <BaseToolbar.Group className={cn(className)} {...props} />;
}

export interface ToolbarButtonProps extends React.ComponentProps<typeof BaseToolbar.Button> {}

export function ToolbarButton({ className, ...props }: ToolbarButtonProps) {
  return <BaseToolbar.Button className={cn(className)} {...props} />;
}

export interface ToolbarSeparatorProps extends React.ComponentProps<typeof BaseToolbar.Separator> {}

export function ToolbarSeparator({ className, ...props }: ToolbarSeparatorProps) {
  return (
    <BaseToolbar.Separator
      className={cn("h-5 w-px shrink-0 bg-line-subtle", className)}
      {...props}
    />
  );
}
