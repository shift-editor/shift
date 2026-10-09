import * as React from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  variant?: "filled" | "plain";
}

const variantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

export function Textarea({ className, variant = "filled", ...props }: TextareaProps) {
  return (
    <BaseField.Control
      render={
        <textarea
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
  );
}
