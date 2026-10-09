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
    Omit<React.ComponentPropsWithoutRef<typeof BaseAutocomplete.Input>, "size" | "className">,
    Pick<
      InputProps,
      "size" | "variant" | "label" | "labelPosition" | "icon" | "iconPosition" | "className"
    > {}

/** The search field, styled as the shared `Input`. */
export const AutocompleteInput = React.forwardRef<HTMLInputElement, AutocompleteInputProps>(
  ({ size, variant, label, labelPosition, icon, iconPosition, className, ...props }, ref) => (
    <BaseAutocomplete.Input
      ref={ref}
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
  ),
);
AutocompleteInput.displayName = "AutocompleteInput";

export interface AutocompleteListProps extends React.ComponentPropsWithoutRef<
  typeof BaseAutocomplete.List
> {}

/** The scrolling list of suggestions; hidden while it has no items. */
export const AutocompleteList = React.forwardRef<HTMLDivElement, AutocompleteListProps>(
  ({ className, ...props }, ref) => (
    <BaseAutocomplete.List
      ref={ref}
      className={cn(
        "scrollbar-hidden min-h-0 overflow-y-auto px-2 py-1.5 outline-none empty:hidden",
        className,
      )}
      {...props}
    />
  ),
);
AutocompleteList.displayName = "AutocompleteList";

export interface AutocompleteItemProps extends React.ComponentPropsWithoutRef<
  typeof BaseAutocomplete.Item
> {}

/** One suggestion; highlighted by the arrow keys and pointer, picked by click or Enter. */
export const AutocompleteItem = React.forwardRef<HTMLDivElement, AutocompleteItemProps>(
  ({ className, ...props }, ref) => (
    <BaseAutocomplete.Item
      ref={ref}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-sm text-primary outline-none",
        "data-[highlighted]:bg-hover/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
AutocompleteItem.displayName = "AutocompleteItem";

export interface AutocompleteEmptyProps extends React.ComponentPropsWithoutRef<
  typeof BaseAutocomplete.Empty
> {}

/** Rendered only when the list has no items. */
export const AutocompleteEmpty = React.forwardRef<HTMLDivElement, AutocompleteEmptyProps>(
  ({ className, ...props }, ref) => (
    <BaseAutocomplete.Empty
      ref={ref}
      className={cn("px-4 text-center text-sm text-muted empty:hidden", className)}
      {...props}
    />
  ),
);
AutocompleteEmpty.displayName = "AutocompleteEmpty";
