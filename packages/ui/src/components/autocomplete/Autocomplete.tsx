import * as React from "react";
import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { cn } from "../../lib/utils";
import { Input, type InputProps } from "../input";

/**
 * Groups a search input with its list of suggestions.
 *
 * @remarks
 * Pass `inline open` to show the list in place (inside a dialog, say) rather
 * than in a popup. With `autoHighlight="always"`, Enter picks the first item.
 */
export const Autocomplete = BaseAutocomplete.Root;

export type AutocompleteProps<ItemValue> = BaseAutocomplete.Root.Props<ItemValue>;

export interface AutocompleteInputProps
  extends
    Omit<React.ComponentProps<typeof BaseAutocomplete.Input>, "size" | "className">,
    Pick<
      InputProps,
      "size" | "variant" | "label" | "labelPosition" | "icon" | "iconPosition" | "className"
    > {}

/** The search field, styled as the shared `Input`. */
export function AutocompleteInput({
  size,
  variant,
  label,
  labelPosition,
  icon,
  iconPosition,
  className,
  ...props
}: AutocompleteInputProps) {
  return (
    <BaseAutocomplete.Input
      render={
        <Input
          size={size}
          variant={variant}
          label={label}
          labelPosition={labelPosition}
          icon={icon}
          iconPosition={iconPosition}
          className={className}
        />
      }
      {...props}
    />
  );
}

export interface AutocompleteListProps extends React.ComponentProps<typeof BaseAutocomplete.List> {}

/** The scrolling list of suggestions; hidden while it has no items. */
export function AutocompleteList({ className, ...props }: AutocompleteListProps) {
  return (
    <BaseAutocomplete.List
      className={cn(
        "scrollbar-hidden min-h-0 overflow-y-auto px-2 py-1.5 outline-none empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

export interface AutocompleteItemProps extends React.ComponentProps<typeof BaseAutocomplete.Item> {}

/** One suggestion; highlighted by the arrow keys and pointer, picked by click or Enter. */
export function AutocompleteItem({ className, ...props }: AutocompleteItemProps) {
  return (
    <BaseAutocomplete.Item
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-sm text-primary outline-none",
        "data-[highlighted]:bg-hover/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export interface AutocompleteEmptyProps extends React.ComponentProps<
  typeof BaseAutocomplete.Empty
> {}

/** Rendered only when the list has no items. */
export function AutocompleteEmpty({ className, ...props }: AutocompleteEmptyProps) {
  return (
    <BaseAutocomplete.Empty
      className={cn("px-4 text-center text-sm text-muted empty:hidden", className)}
      {...props}
    />
  );
}
