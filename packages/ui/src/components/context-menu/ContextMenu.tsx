import * as React from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";
import { menuItemStyles, menuPopupStyles } from "../menu/styles";

export interface ContextMenuProps extends React.ComponentProps<typeof BaseContextMenu.Root> {}

export const ContextMenu = (props: ContextMenuProps) => <BaseContextMenu.Root {...props} />;

export interface ContextMenuTriggerProps extends React.ComponentProps<
  typeof BaseContextMenu.Trigger
> {}

export function ContextMenuTrigger({ className, ...props }: ContextMenuTriggerProps) {
  return <BaseContextMenu.Trigger className={cn(className)} {...props} />;
}

export function ContextMenuPortal(props: React.ComponentProps<typeof BaseContextMenu.Portal>) {
  const container = usePortalContainer();
  return <BaseContextMenu.Portal container={container} {...props} />;
}

export interface ContextMenuPositionerProps extends React.ComponentProps<
  typeof BaseContextMenu.Positioner
> {}

export function ContextMenuPositioner({ className, ...props }: ContextMenuPositionerProps) {
  return <BaseContextMenu.Positioner className={cn("z-50", className)} {...props} />;
}

export interface ContextMenuPopupProps extends React.ComponentProps<typeof BaseContextMenu.Popup> {}

export function ContextMenuPopup({ className, ...props }: ContextMenuPopupProps) {
  return <BaseContextMenu.Popup className={cn(menuPopupStyles, "w-50", className)} {...props} />;
}

export interface ContextMenuItemProps extends React.ComponentProps<typeof BaseContextMenu.Item> {
  variant?: "default" | "danger" | "outlined";
}

export function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      className={cn(
        menuItemStyles,
        variant === "danger" && "text-destructive data-[highlighted]:bg-destructive-hover",
        variant === "outlined" &&
          "h-8 justify-center gap-2 border border-line-subtle bg-surface-muted hover:bg-hover data-[highlighted]:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

export interface ContextMenuSeparatorProps extends React.ComponentProps<
  typeof BaseContextMenu.Separator
> {}

export function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return (
    <BaseContextMenu.Separator
      className={cn("-mx-1 my-1 h-px bg-line-subtle", className)}
      {...props}
    />
  );
}
