import { Button, cn, type ButtonProps } from "@shift/ui";
import { forwardRef } from "react";

export interface SidebarRowButtonProps extends Omit<ButtonProps, "size"> {}

export const SidebarRowButton = forwardRef<HTMLButtonElement, SidebarRowButtonProps>(
  ({ className, variant = "ghost", ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="sm"
      className={cn("h-7 w-full min-w-0 justify-start px-2 text-ui font-normal", className)}
      {...props}
    />
  ),
);

SidebarRowButton.displayName = "SidebarRowButton";
