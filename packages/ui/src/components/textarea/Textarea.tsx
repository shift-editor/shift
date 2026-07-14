import * as React from "react";
import { Field as BaseField } from "@base-ui-components/react/field";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.ComponentPropsWithoutRef<"textarea"> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <BaseField.Control
      render={
        <textarea
          ref={ref}
          className={cn(
            "min-h-20 w-full resize-y rounded bg-input px-2 py-1.5 text-sm text-primary outline-none",
            "focus:ring-1 focus:ring-accent data-[invalid]:ring-1 data-[invalid]:ring-red-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
      }
    />
  ),
);
Textarea.displayName = "Textarea";
