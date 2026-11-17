import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

export interface DialogProps extends React.ComponentProps<typeof BaseDialog.Root> {}

export const Dialog = (props: DialogProps) => <BaseDialog.Root {...props} />;

export interface DialogBackdropProps extends React.ComponentProps<typeof BaseDialog.Backdrop> {
  /** `light` barely dims the window, for a small panel over the work it changes. */
  variant?: "light";
}

export function DialogBackdrop({ className, variant, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop
      className={cn(
        "fixed inset-0 z-50",
        variant === "light" ? "bg-black/10" : "bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

export function DialogPortal(props: React.ComponentProps<typeof BaseDialog.Portal>) {
  const container = usePortalContainer();
  return <BaseDialog.Portal container={container} {...props} />;
}

export interface DialogPopupProps extends React.ComponentProps<typeof BaseDialog.Popup> {
  /**
   * `panel` looks like a popover: a hairline border, a smaller corner and UI
   * type, with no padding so a title row and an action row can run edge to edge.
   */
  variant?: "panel";
}

export function DialogPopup({ className, variant, ...props }: DialogPopupProps) {
  return (
    <BaseDialog.Popup
      className={cn(
        "fixed left-1/2 top-1/5 z-50 w-full max-w-lg -translate-x-1/2 bg-surface shadow-lg",
        variant === "panel" ? "rounded-md border border-line-subtle font-ui text-ui" : "rounded-lg",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogTitleProps extends React.ComponentProps<typeof BaseDialog.Title> {
  /** `panel` matches a popover's title, for a {@link DialogPopup} of that variant. */
  variant?: "panel";
}

export function DialogTitle({ className, variant, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      className={cn(
        "font-medium text-primary",
        variant === "panel" ? "text-ui" : "text-sm",
        className,
      )}
      {...props}
    />
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
