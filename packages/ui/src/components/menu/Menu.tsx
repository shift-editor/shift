import * as React from "react";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { cn } from "../../lib/utils";

export interface MenuProps extends React.ComponentProps<typeof BaseMenu.Root> {}

export const Menu = (props: MenuProps) => <BaseMenu.Root {...props} />;

export interface MenuTriggerProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger> {}

export const MenuTrigger = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Trigger>,
  MenuTriggerProps
>(({ className, ...props }, ref) => (
  <BaseMenu.Trigger ref={ref} className={cn(className)} {...props} />
));
MenuTrigger.displayName = "MenuTrigger";

export const MenuPortal = BaseMenu.Portal;

export interface MenuPositionerProps extends React.ComponentPropsWithoutRef<
  typeof BaseMenu.Positioner
> {}

export const MenuPositioner = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Positioner>,
  MenuPositionerProps
>(({ className, ...props }, ref) => (
  <BaseMenu.Positioner ref={ref} className={cn("z-50", className)} {...props} />
));
MenuPositioner.displayName = "MenuPositioner";

export interface MenuPopupProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Popup> {}

export const MenuPopup = React.forwardRef<React.ElementRef<typeof BaseMenu.Popup>, MenuPopupProps>(
  ({ className, ...props }, ref) => (
    <BaseMenu.Popup
      ref={ref}
      className={cn(
        "min-w-32 rounded-md border border-line-subtle bg-surface p-1 shadow-lg",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  ),
);
MenuPopup.displayName = "MenuPopup";

const menuItemStyles =
  "flex h-7 cursor-pointer select-none items-center rounded px-2 text-sm text-primary outline-none data-[highlighted]:bg-hover/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export interface MenuItemProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Item> {
  variant?: "default" | "danger";
}

export const MenuItem = React.forwardRef<React.ElementRef<typeof BaseMenu.Item>, MenuItemProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <BaseMenu.Item
      ref={ref}
      className={cn(
        menuItemStyles,
        variant === "danger" && "text-red-600 data-[highlighted]:bg-red-50",
        className,
      )}
      {...props}
    />
  ),
);
MenuItem.displayName = "MenuItem";

export interface MenuCheckboxItemProps extends React.ComponentPropsWithoutRef<
  typeof BaseMenu.CheckboxItem
> {}

export const MenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof BaseMenu.CheckboxItem>,
  MenuCheckboxItemProps
>(({ className, ...props }, ref) => (
  <BaseMenu.CheckboxItem ref={ref} className={cn(menuItemStyles, className)} {...props} />
));
MenuCheckboxItem.displayName = "MenuCheckboxItem";

export interface MenuCheckboxItemIndicatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseMenu.CheckboxItemIndicator
> {}

export const MenuCheckboxItemIndicator = React.forwardRef<
  React.ElementRef<typeof BaseMenu.CheckboxItemIndicator>,
  MenuCheckboxItemIndicatorProps
>(({ className, ...props }, ref) => (
  <BaseMenu.CheckboxItemIndicator
    ref={ref}
    className={cn("flex items-center justify-center", className)}
    {...props}
  />
));
MenuCheckboxItemIndicator.displayName = "MenuCheckboxItemIndicator";

export interface MenuSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseMenu.Separator
> {}

export const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof BaseMenu.Separator>,
  MenuSeparatorProps
>(({ className, ...props }, ref) => (
  <BaseMenu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-line-subtle", className)}
    {...props}
  />
));
MenuSeparator.displayName = "MenuSeparator";
