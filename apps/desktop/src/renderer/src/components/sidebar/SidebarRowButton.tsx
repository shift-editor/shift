import { Button, cn, type ButtonProps } from "@shift/ui";
import { forwardRef } from "react";

export interface SidebarRowButtonProps extends Omit<ButtonProps, "size" | "variant"> {}

export const SidebarRowButton = forwardRef<HTMLButtonElement, SidebarRowButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className={cn("h-7 w-full min-w-0 justify-start gap-2 px-2 text-ui font-normal", className)}
      {...props}
    />
  ),
);

SidebarRowButton.displayName = "SidebarRowButton";
