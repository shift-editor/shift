import * as React from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { cn } from "../../lib/utils";

export interface NumberFieldProps extends React.ComponentProps<typeof BaseNumberField.Root> {}

export function NumberField({ className, ...props }: NumberFieldProps) {
  return <BaseNumberField.Root className={cn("min-w-0", className)} {...props} />;
}

export interface NumberFieldGroupProps extends React.ComponentProps<typeof BaseNumberField.Group> {
  variant?: "filled" | "plain";
}

const groupVariantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

export function NumberFieldGroup({
  className,
  variant = "filled",
  ...props
}: NumberFieldGroupProps) {
  return (
    <BaseNumberField.Group
      className={cn(
        "flex h-7 min-w-0 items-center overflow-hidden rounded",
        "focus-within:ring-1 focus-within:ring-accent data-[invalid]:ring-1 data-[invalid]:ring-error-ring",
        groupVariantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export interface NumberFieldInputProps extends Omit<
  React.ComponentProps<typeof BaseNumberField.Input>,
  "size"
> {
  /** Replaces the native numeric `size` attribute. `compact` matches the dense `Input` used in sidebars. */
  size?: "compact" | "md";
}

const inputSizeStyles = {
  compact: "text-ui",
  md: "text-sm",
};

export function NumberFieldInput({ className, size = "md", ...props }: NumberFieldInputProps) {
  return (
    <BaseNumberField.Input
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent px-2 text-primary outline-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        inputSizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}

const stepButtonStyles =
  "flex h-full w-6 cursor-pointer items-center justify-center text-secondary outline-none hover:bg-hover/50 hover:text-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export interface NumberFieldIncrementProps extends React.ComponentProps<
  typeof BaseNumberField.Increment
> {}

export function NumberFieldIncrement({ className, ...props }: NumberFieldIncrementProps) {
  return <BaseNumberField.Increment className={cn(stepButtonStyles, className)} {...props} />;
}

export interface NumberFieldDecrementProps extends React.ComponentProps<
  typeof BaseNumberField.Decrement
> {}

export function NumberFieldDecrement({ className, ...props }: NumberFieldDecrementProps) {
  return <BaseNumberField.Decrement className={cn(stepButtonStyles, className)} {...props} />;
}

export interface NumberFieldScrubAreaProps extends React.ComponentProps<
  typeof BaseNumberField.ScrubArea
> {}

export function NumberFieldScrubArea({ className, ...props }: NumberFieldScrubAreaProps) {
  return (
    <BaseNumberField.ScrubArea
      className={cn("cursor-ew-resize select-none text-xs text-secondary", className)}
      {...props}
    />
  );
}

export const NumberFieldScrubAreaCursor = BaseNumberField.ScrubAreaCursor;
