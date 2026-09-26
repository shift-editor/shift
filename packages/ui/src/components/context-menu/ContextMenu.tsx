import * as React from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui-components/react/context-menu";
import { cn } from "../../lib/utils";
import { menuItemStyles, menuPopupStyles } from "../menu/styles";

export interface ContextMenuProps extends React.ComponentProps<typeof BaseContextMenu.Root> {}

export const ContextMenu = (props: ContextMenuProps) => <BaseContextMenu.Root {...props} />;

export interface ContextMenuTriggerProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Trigger
> {}

export const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof BaseContextMenu.Trigger>,
  ContextMenuTriggerProps
>(({ className, ...props }, ref) => (
  <BaseContextMenu.Trigger ref={ref} className={cn(className)} {...props} />
));
ContextMenuTrigger.displayName = "ContextMenuTrigger";

export const ContextMenuPortal = BaseContextMenu.Portal;

export interface ContextMenuPositionerProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Positioner
> {}

export const ContextMenuPositioner = React.forwardRef<
  React.ElementRef<typeof BaseContextMenu.Positioner>,
  ContextMenuPositionerProps
>(({ className, ...props }, ref) => (
  <BaseContextMenu.Positioner ref={ref} className={cn("z-50", className)} {...props} />
));
ContextMenuPositioner.displayName = "ContextMenuPositioner";

export interface ContextMenuPopupProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Popup
> {}

export const ContextMenuPopup = React.forwardRef<
  React.ElementRef<typeof BaseContextMenu.Popup>,
  ContextMenuPopupProps
>(({ className, ...props }, ref) => (
  <BaseContextMenu.Popup ref={ref} className={cn(menuPopupStyles, "w-50", className)} {...props} />
));
ContextMenuPopup.displayName = "ContextMenuPopup";

export interface ContextMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Item
> {
  variant?: "default" | "danger" | "outlined";
}

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof BaseContextMenu.Item>,
  ContextMenuItemProps
>(({ className, variant = "default", ...props }, ref) => (
  <BaseContextMenu.Item
    ref={ref}
    className={cn(
      menuItemStyles,
      variant === "danger" && "text-destructive data-[highlighted]:bg-destructive-hover",
      variant === "outlined" &&
        "h-8 justify-center gap-2 border border-line-subtle bg-surface-muted hover:bg-hover data-[highlighted]:bg-hover",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export interface ContextMenuSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Separator
> {}

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof BaseContextMenu.Separator>,
  ContextMenuSeparatorProps
>(({ className, ...props }, ref) => (
  <BaseContextMenu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-line-subtle", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
