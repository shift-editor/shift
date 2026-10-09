import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

export interface PopoverProps extends React.ComponentProps<typeof BasePopover.Root> {}

export const Popover = (props: PopoverProps) => <BasePopover.Root {...props} />;

export interface PopoverTriggerProps extends React.ComponentProps<typeof BasePopover.Trigger> {}

export function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return <BasePopover.Trigger className={cn(className)} {...props} />;
}

export function PopoverPortal(props: React.ComponentProps<typeof BasePopover.Portal>) {
  const container = usePortalContainer();
  return <BasePopover.Portal container={container} {...props} />;
}

export interface PopoverPositionerProps extends React.ComponentProps<
  typeof BasePopover.Positioner
> {}

export function PopoverPositioner({ className, ...props }: PopoverPositionerProps) {
  return <BasePopover.Positioner className={cn("z-50", className)} {...props} />;
}

export interface PopoverPopupProps extends React.ComponentProps<typeof BasePopover.Popup> {}

export function PopoverPopup({ className, ...props }: PopoverPopupProps) {
  return (
    <BasePopover.Popup
      className={cn(
        "min-w-32 rounded-md border border-line-subtle bg-surface p-1 shadow-lg",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export interface PopoverTitleProps extends React.ComponentProps<typeof BasePopover.Title> {}

export function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return (
    <BasePopover.Title className={cn("text-ui font-medium text-primary", className)} {...props} />
  );
}

export interface PopoverCloseProps extends React.ComponentProps<typeof BasePopover.Close> {
  variant?: "icon";
}

export function PopoverClose({ className, variant, ...props }: PopoverCloseProps) {
  return (
    <BasePopover.Close
      className={cn(
        variant === "icon" &&
          "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-primary/70 transition-colors hover:bg-hover hover:text-primary",
        className,
      )}
      {...props}
    />
  );
}
