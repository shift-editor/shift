import * as React from "react";
import { Select as BaseSelect, type SelectRootProps } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

export type SelectProps<Value, Multiple extends boolean | undefined = false> = SelectRootProps<
  Value,
  Multiple
>;

export function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
): React.JSX.Element {
  return <BaseSelect.Root {...props} />;
}

export interface SelectTriggerProps extends React.ComponentProps<typeof BaseSelect.Trigger> {
  variant?: "filled" | "plain";
}

const triggerVariantStyles = {
  filled: "bg-input",
  plain: "bg-background",
};

export function SelectTrigger({ className, variant = "filled", ...props }: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded px-2",
        "text-sm text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        triggerVariantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export const SelectValue = BaseSelect.Value;

export interface SelectIconProps extends React.ComponentProps<typeof BaseSelect.Icon> {}

export function SelectIcon({ className, children, ...props }: SelectIconProps) {
  return (
    <BaseSelect.Icon className={cn("shrink-0 text-muted", className)} {...props}>
      {children ?? <ChevronDown className="h-3.5 w-3.5" />}
    </BaseSelect.Icon>
  );
}

export function SelectPortal(props: React.ComponentProps<typeof BaseSelect.Portal>) {
  const container = usePortalContainer();
  return <BaseSelect.Portal container={container} {...props} />;
}

export interface SelectPositionerProps extends React.ComponentProps<typeof BaseSelect.Positioner> {}

export function SelectPositioner({ className, ...props }: SelectPositionerProps) {
  return <BaseSelect.Positioner className={cn("z-50", className)} {...props} />;
}

export interface SelectPopupProps extends React.ComponentProps<typeof BaseSelect.Popup> {}

export function SelectPopup({ className, ...props }: SelectPopupProps) {
  return (
    <BaseSelect.Popup
      className={cn(
        "min-w-(--anchor-width) rounded-md border border-line-subtle bg-surface p-1 shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  );
}

export const SelectList = BaseSelect.List;

export interface SelectItemProps extends React.ComponentProps<typeof BaseSelect.Item> {}

export function SelectItem({ className, ...props }: SelectItemProps) {
  return (
    <BaseSelect.Item
      className={cn(
        "grid h-7 cursor-pointer select-none grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded px-2",
        "text-sm whitespace-nowrap text-primary outline-none data-[highlighted]:bg-hover/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export interface SelectItemIndicatorProps extends React.ComponentProps<
  typeof BaseSelect.ItemIndicator
> {}

export function SelectItemIndicator({ className, children, ...props }: SelectItemIndicatorProps) {
  return (
    <BaseSelect.ItemIndicator
      className={cn("flex items-center justify-center", className)}
      {...props}
    >
      {children ?? <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </BaseSelect.ItemIndicator>
  );
}

export interface SelectItemTextProps extends React.ComponentProps<typeof BaseSelect.ItemText> {}

/**
 * Option label, pinned to the item's second column so unselected options,
 * which render no indicator, stay aligned with the selected one.
 */
export function SelectItemText({ className, ...props }: SelectItemTextProps) {
  return <BaseSelect.ItemText className={cn("col-start-2", className)} {...props} />;
}
