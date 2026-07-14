import * as React from "react";
import { NumberField as BaseNumberField } from "@base-ui-components/react/number-field";
import { cn } from "../../lib/utils";

export interface NumberFieldProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.Root
> {}

export const NumberField = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.Root>,
  NumberFieldProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.Root ref={ref} className={cn("min-w-0", className)} {...props} />
));
NumberField.displayName = "NumberField";

export interface NumberFieldGroupProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.Group
> {}

export const NumberFieldGroup = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.Group>,
  NumberFieldGroupProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.Group
    ref={ref}
    className={cn(
      "flex h-7 min-w-0 items-center overflow-hidden rounded bg-input",
      "focus-within:ring-1 focus-within:ring-accent data-[invalid]:ring-1 data-[invalid]:ring-red-500",
      className,
    )}
    {...props}
  />
));
NumberFieldGroup.displayName = "NumberFieldGroup";

export interface NumberFieldInputProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.Input
> {}

export const NumberFieldInput = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.Input>,
  NumberFieldInputProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.Input
    ref={ref}
    className={cn(
      "h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-primary outline-none",
      "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
NumberFieldInput.displayName = "NumberFieldInput";

const stepButtonStyles =
  "flex h-full w-6 cursor-pointer items-center justify-center text-secondary outline-none hover:bg-hover/50 hover:text-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export interface NumberFieldIncrementProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.Increment
> {}

export const NumberFieldIncrement = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.Increment>,
  NumberFieldIncrementProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.Increment ref={ref} className={cn(stepButtonStyles, className)} {...props} />
));
NumberFieldIncrement.displayName = "NumberFieldIncrement";

export interface NumberFieldDecrementProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.Decrement
> {}

export const NumberFieldDecrement = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.Decrement>,
  NumberFieldDecrementProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.Decrement ref={ref} className={cn(stepButtonStyles, className)} {...props} />
));
NumberFieldDecrement.displayName = "NumberFieldDecrement";

export interface NumberFieldScrubAreaProps extends React.ComponentPropsWithoutRef<
  typeof BaseNumberField.ScrubArea
> {}

export const NumberFieldScrubArea = React.forwardRef<
  React.ElementRef<typeof BaseNumberField.ScrubArea>,
  NumberFieldScrubAreaProps
>(({ className, ...props }, ref) => (
  <BaseNumberField.ScrubArea
    ref={ref}
    className={cn("cursor-ew-resize select-none text-xs text-secondary", className)}
    {...props}
  />
));
NumberFieldScrubArea.displayName = "NumberFieldScrubArea";

export const NumberFieldScrubAreaCursor = BaseNumberField.ScrubAreaCursor;
