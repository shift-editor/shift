import * as React from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "../../lib/utils";

export interface FieldProps extends React.ComponentProps<typeof BaseField.Root> {}

export function Field({ className, ...props }: FieldProps) {
  return <BaseField.Root className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />;
}

export interface FieldLabelProps extends React.ComponentProps<typeof BaseField.Label> {
  tone?: "primary" | "secondary";
}

const fieldLabelToneStyles = {
  primary: "text-primary",
  secondary: "text-secondary",
};

export function FieldLabel({ className, tone = "secondary", ...props }: FieldLabelProps) {
  return (
    <BaseField.Label className={cn("text-xs", fieldLabelToneStyles[tone], className)} {...props} />
  );
}

export interface FieldControlProps extends Omit<
  React.ComponentProps<typeof BaseField.Control>,
  "ref"
> {
  variant?: "filled" | "plain";
  /** The rendered `<input>`; Base UI types it as any element. */
  ref?: React.Ref<HTMLInputElement>;
}

const fieldControlVariantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

export function FieldControl({ className, variant = "filled", ...props }: FieldControlProps) {
  return (
    <BaseField.Control
      className={cn(
        "h-7 w-full rounded px-2 text-sm text-primary outline-none",
        "focus:ring-1 focus:ring-inset focus:ring-accent",
        "data-[invalid]:ring-1 data-[invalid]:ring-inset data-[invalid]:ring-error-ring",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        fieldControlVariantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export interface FieldDescriptionProps extends React.ComponentProps<typeof BaseField.Description> {}

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return <BaseField.Description className={cn("text-xs text-muted", className)} {...props} />;
}

export interface FieldErrorProps extends React.ComponentProps<typeof BaseField.Error> {}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return <BaseField.Error className={cn("text-xs text-error", className)} {...props} />;
}
