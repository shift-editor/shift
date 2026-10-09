import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";
import { menubarTriggerStyles, menuItemStyles, menuPopupStyles } from "./styles";

export interface MenuProps extends React.ComponentProps<typeof BaseMenu.Root> {}

export const Menu = (props: MenuProps) => <BaseMenu.Root {...props} />;

export interface MenuTriggerProps extends React.ComponentProps<typeof BaseMenu.Trigger> {
  /** `menubar` styles the trigger as a top-level entry in a `Menubar`. */
  variant?: "default" | "menubar";
}

export function MenuTrigger({ className, variant = "default", ...props }: MenuTriggerProps) {
  return (
    <BaseMenu.Trigger
      className={cn(variant === "menubar" && menubarTriggerStyles, className)}
      {...props}
    />
  );
}

export function MenuPortal(props: React.ComponentProps<typeof BaseMenu.Portal>) {
  const container = usePortalContainer();
  return <BaseMenu.Portal container={container} {...props} />;
}

export interface MenuPositionerProps extends React.ComponentProps<typeof BaseMenu.Positioner> {}

export function MenuPositioner({ className, ...props }: MenuPositionerProps) {
  return <BaseMenu.Positioner className={cn("z-50", className)} {...props} />;
}

export interface MenuPopupProps extends React.ComponentProps<typeof BaseMenu.Popup> {}

export function MenuPopup({ className, ...props }: MenuPopupProps) {
  return <BaseMenu.Popup className={cn(menuPopupStyles, className)} {...props} />;
}

export interface MenuItemProps extends React.ComponentProps<typeof BaseMenu.Item> {
  variant?: "default" | "danger" | "outlined";
}

export function MenuItem({ className, variant = "default", ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item
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

export interface MenuCheckboxItemProps extends React.ComponentProps<typeof BaseMenu.CheckboxItem> {}

export function MenuCheckboxItem({ className, ...props }: MenuCheckboxItemProps) {
  return <BaseMenu.CheckboxItem className={cn(menuItemStyles, className)} {...props} />;
}

export interface MenuCheckboxItemIndicatorProps extends React.ComponentProps<
  typeof BaseMenu.CheckboxItemIndicator
> {}

export function MenuCheckboxItemIndicator({ className, ...props }: MenuCheckboxItemIndicatorProps) {
  return (
    <BaseMenu.CheckboxItemIndicator
      className={cn("flex items-center justify-center", className)}
      {...props}
    />
  );
}

export interface MenuSeparatorProps extends React.ComponentProps<typeof BaseMenu.Separator> {}

export function MenuSeparator({ className, ...props }: MenuSeparatorProps) {
  return (
    <BaseMenu.Separator className={cn("-mx-1 my-1 h-px bg-line-subtle", className)} {...props} />
  );
}

export interface MenuSubmenuRootProps extends React.ComponentProps<typeof BaseMenu.SubmenuRoot> {}

export const MenuSubmenuRoot = (props: MenuSubmenuRootProps) => <BaseMenu.SubmenuRoot {...props} />;

export interface MenuSubmenuTriggerProps extends React.ComponentProps<
  typeof BaseMenu.SubmenuTrigger
> {}

export function MenuSubmenuTrigger({ className, ...props }: MenuSubmenuTriggerProps) {
  return (
    <BaseMenu.SubmenuTrigger
      className={cn(
        menuItemStyles,
        "justify-between gap-6 data-[popup-open]:bg-hover/50",
        className,
      )}
      {...props}
    />
  );
}
