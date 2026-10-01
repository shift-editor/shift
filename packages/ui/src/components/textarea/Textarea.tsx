import * as React from "react";
import { Field as BaseField } from "@base-ui-components/react/field";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.ComponentPropsWithoutRef<"textarea"> {
  variant?: "filled" | "plain";
}

const variantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "filled", ...props }, ref) => (
    <BaseField.Control
      render={
        <textarea
          ref={ref}
          className={cn(
            "min-h-20 w-full resize-y rounded px-2 py-1.5 text-sm text-primary outline-none",
            "focus:ring-1 focus:ring-accent data-[invalid]:ring-1 data-[invalid]:ring-error-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            variantStyles[variant],
            className,
          )}
          {...props}
        />
      }
    />
  ),
);
Textarea.displayName = "Textarea";
