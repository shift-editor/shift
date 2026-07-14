import * as React from "react";
import { Select as BaseSelect, type SelectRootProps } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export type SelectProps<Value, Multiple extends boolean | undefined = false> = SelectRootProps<
  Value,
  Multiple
>;

export function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
): React.JSX.Element {
  return <BaseSelect.Root {...props} />;
}

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<
  typeof BaseSelect.Trigger
> {}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof BaseSelect.Trigger>,
  SelectTriggerProps
>(({ className, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      "flex h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded bg-input px-2",
      "text-sm text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = BaseSelect.Value;

export interface SelectIconProps extends React.ComponentPropsWithoutRef<typeof BaseSelect.Icon> {}

export const SelectIcon = React.forwardRef<
  React.ElementRef<typeof BaseSelect.Icon>,
  SelectIconProps
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Icon ref={ref} className={cn("shrink-0 text-muted", className)} {...props}>
    {children ?? <ChevronDown className="h-3.5 w-3.5" />}
  </BaseSelect.Icon>
));
SelectIcon.displayName = "SelectIcon";

export const SelectPortal = BaseSelect.Portal;

export interface SelectPositionerProps extends React.ComponentPropsWithoutRef<
  typeof BaseSelect.Positioner
> {}

export const SelectPositioner = React.forwardRef<
  React.ElementRef<typeof BaseSelect.Positioner>,
  SelectPositionerProps
>(({ className, ...props }, ref) => (
  <BaseSelect.Positioner ref={ref} className={cn("z-50", className)} {...props} />
));
SelectPositioner.displayName = "SelectPositioner";

export interface SelectPopupProps extends React.ComponentPropsWithoutRef<typeof BaseSelect.Popup> {}

export const SelectPopup = React.forwardRef<
  React.ElementRef<typeof BaseSelect.Popup>,
  SelectPopupProps
>(({ className, ...props }, ref) => (
  <BaseSelect.Popup
    ref={ref}
    className={cn(
      "min-w-[var(--anchor-width)] rounded-md border border-line-subtle bg-surface p-1 shadow-lg outline-none",
      className,
    )}
    {...props}
  />
));
SelectPopup.displayName = "SelectPopup";

export const SelectList = BaseSelect.List;

export interface SelectItemProps extends React.ComponentPropsWithoutRef<typeof BaseSelect.Item> {}

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof BaseSelect.Item>,
  SelectItemProps
>(({ className, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      "grid h-7 cursor-pointer select-none grid-cols-[1rem_minmax(0,1fr)] items-center rounded px-1",
      "text-sm text-primary outline-none data-[highlighted]:bg-hover/50",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
SelectItem.displayName = "SelectItem";

export interface SelectItemIndicatorProps extends React.ComponentPropsWithoutRef<
  typeof BaseSelect.ItemIndicator
> {}

export const SelectItemIndicator = React.forwardRef<
  React.ElementRef<typeof BaseSelect.ItemIndicator>,
  SelectItemIndicatorProps
>(({ className, children, ...props }, ref) => (
  <BaseSelect.ItemIndicator
    ref={ref}
    className={cn("flex items-center justify-center", className)}
    {...props}
  >
    {children ?? <Check className="h-3.5 w-3.5" />}
  </BaseSelect.ItemIndicator>
));
SelectItemIndicator.displayName = "SelectItemIndicator";

export const SelectItemText = BaseSelect.ItemText;
