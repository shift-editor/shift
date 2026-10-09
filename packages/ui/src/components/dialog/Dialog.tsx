import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

export interface DialogProps extends React.ComponentProps<typeof BaseDialog.Root> {}

export const Dialog = (props: DialogProps) => <BaseDialog.Root {...props} />;

export interface DialogBackdropProps extends React.ComponentProps<typeof BaseDialog.Backdrop> {}

export function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop className={cn("fixed inset-0 z-50 bg-black/50", className)} {...props} />
  );
}

export function DialogPortal(props: React.ComponentProps<typeof BaseDialog.Portal>) {
  const container = usePortalContainer();
  return <BaseDialog.Portal container={container} {...props} />;
}

export interface DialogPopupProps extends React.ComponentProps<typeof BaseDialog.Popup> {}

export function DialogPopup({ className, ...props }: DialogPopupProps) {
  return (
    <BaseDialog.Popup
      className={cn(
        "fixed left-1/2 top-1/5 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg bg-surface shadow-lg",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogTitleProps extends React.ComponentProps<typeof BaseDialog.Title> {}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title className={cn("text-sm font-medium text-primary", className)} {...props} />
  );
}

export function DialogClose({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof BaseDialog.Close> & { variant?: "icon" }) {
  return (
    <BaseDialog.Close
      className={cn(
        variant === "icon" &&
          "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-primary/70 transition-colors hover:bg-hover hover:text-primary",
        className,
      )}
      {...props}
    />
  );
}
