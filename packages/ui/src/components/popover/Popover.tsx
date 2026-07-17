import * as React from "react";
import { Popover as BasePopover } from "@base-ui-components/react/popover";
import { cn } from "../../lib/utils";

export interface PopoverProps extends React.ComponentProps<typeof BasePopover.Root> {}

export const Popover = (props: PopoverProps) => <BasePopover.Root {...props} />;

export interface PopoverTriggerProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Trigger
> {}

export const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof BasePopover.Trigger>,
  PopoverTriggerProps
>(({ className, ...props }, ref) => (
  <BasePopover.Trigger ref={ref} className={cn(className)} {...props} />
));
PopoverTrigger.displayName = "PopoverTrigger";

export const PopoverPortal = BasePopover.Portal;

export interface PopoverPositionerProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Positioner
> {}

export const PopoverPositioner = React.forwardRef<
  React.ElementRef<typeof BasePopover.Positioner>,
  PopoverPositionerProps
>(({ className, ...props }, ref) => (
  <BasePopover.Positioner ref={ref} className={cn("z-50", className)} {...props} />
));
PopoverPositioner.displayName = "PopoverPositioner";

export interface PopoverPopupProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Popup
> {}

export const PopoverPopup = React.forwardRef<
  React.ElementRef<typeof BasePopover.Popup>,
  PopoverPopupProps
>(({ className, ...props }, ref) => (
  <BasePopover.Popup
    ref={ref}
    className={cn(
      "min-w-32 rounded-md border border-line-subtle bg-surface p-1 shadow-lg",
      "focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
PopoverPopup.displayName = "PopoverPopup";

export interface PopoverTitleProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Title
> {}

export const PopoverTitle = React.forwardRef<
  React.ElementRef<typeof BasePopover.Title>,
  PopoverTitleProps
>(({ className, ...props }, ref) => (
  <BasePopover.Title ref={ref} className={cn(className)} {...props} />
));
PopoverTitle.displayName = "PopoverTitle";

export interface PopoverCloseProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Close
> {}

export const PopoverClose = React.forwardRef<
  React.ElementRef<typeof BasePopover.Close>,
  PopoverCloseProps
>(({ className, ...props }, ref) => (
  <BasePopover.Close ref={ref} className={cn(className)} {...props} />
));
PopoverClose.displayName = "PopoverClose";
