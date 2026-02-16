import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { cn } from "../../lib/utils";

export interface DialogProps extends React.ComponentProps<typeof BaseDialog.Root> {}

export const Dialog = (props: DialogProps) => <BaseDialog.Root {...props} />;

export interface DialogBackdropProps extends React.ComponentProps<typeof BaseDialog.Backdrop> {}

export const DialogBackdrop = React.forwardRef<HTMLDivElement, DialogBackdropProps>(
  ({ className, ...props }, ref) => (
    <BaseDialog.Backdrop
      ref={ref}
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  ),
);
DialogBackdrop.displayName = "DialogBackdrop";

export const DialogPortal = BaseDialog.Portal;

export interface DialogPopupProps extends React.ComponentProps<typeof BaseDialog.Popup> {}

export const DialogPopup = React.forwardRef<HTMLDivElement, DialogPopupProps>(
  ({ className, ...props }, ref) => (
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        "fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border bg-surface shadow-lg",
        className,
      )}
      {...props}
    />
  ),
);
DialogPopup.displayName = "DialogPopup";

export interface DialogTitleProps extends React.ComponentProps<typeof BaseDialog.Title> {}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, ...props }, ref) => (
    <BaseDialog.Title ref={ref} className={cn(className)} {...props} />
  ),
);
DialogTitle.displayName = "DialogTitle";

export const DialogClose = BaseDialog.Close;
