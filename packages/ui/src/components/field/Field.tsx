import * as React from "react";
import { Field as BaseField } from "@base-ui-components/react/field";
import { cn } from "../../lib/utils";

export interface FieldProps extends React.ComponentPropsWithoutRef<typeof BaseField.Root> {}

export const Field = React.forwardRef<React.ElementRef<typeof BaseField.Root>, FieldProps>(
  ({ className, ...props }, ref) => (
    <BaseField.Root ref={ref} className={cn("flex min-w-0 flex-col gap-1", className)} {...props} />
  ),
);
Field.displayName = "Field";

export interface FieldLabelProps extends React.ComponentPropsWithoutRef<typeof BaseField.Label> {}

export const FieldLabel = React.forwardRef<
  React.ElementRef<typeof BaseField.Label>,
  FieldLabelProps
>(({ className, ...props }, ref) => (
  <BaseField.Label ref={ref} className={cn("text-xs text-secondary", className)} {...props} />
));
FieldLabel.displayName = "FieldLabel";

export interface FieldControlProps extends React.ComponentPropsWithoutRef<
  typeof BaseField.Control
> {}

export const FieldControl = React.forwardRef<
  React.ElementRef<typeof BaseField.Control>,
  FieldControlProps
>(({ className, ...props }, ref) => (
  <BaseField.Control
    ref={ref}
    className={cn(
      "h-7 w-full rounded bg-input px-2 text-sm text-primary outline-none",
      "focus:ring-1 focus:ring-accent data-[invalid]:ring-1 data-[invalid]:ring-red-500",
      "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
FieldControl.displayName = "FieldControl";

export interface FieldDescriptionProps extends React.ComponentPropsWithoutRef<
  typeof BaseField.Description
> {}

export const FieldDescription = React.forwardRef<
  React.ElementRef<typeof BaseField.Description>,
  FieldDescriptionProps
>(({ className, ...props }, ref) => (
  <BaseField.Description ref={ref} className={cn("text-xs text-muted", className)} {...props} />
));
FieldDescription.displayName = "FieldDescription";

export interface FieldErrorProps extends React.ComponentPropsWithoutRef<typeof BaseField.Error> {}

export const FieldError = React.forwardRef<
  React.ElementRef<typeof BaseField.Error>,
  FieldErrorProps
>(({ className, ...props }, ref) => (
  <BaseField.Error ref={ref} className={cn("text-xs text-red-600", className)} {...props} />
));
FieldError.displayName = "FieldError";
