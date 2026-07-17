import { NumberField, NumberFieldGroup, NumberFieldInput, cn } from "@shift/ui";

interface SettingsNumberFieldProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  onValueCommitted: () => Promise<void>;
  ariaLabel: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

export const SettingsNumberField = ({
  value,
  onValueChange,
  onValueCommitted,
  ariaLabel,
  className,
  inputClassName,
  disabled,
}: SettingsNumberFieldProps) => (
  <NumberField
    value={value}
    onValueChange={onValueChange}
    onValueCommitted={async () => {
      await onValueCommitted();
    }}
    disabled={disabled}
  >
    <NumberFieldGroup className={cn("h-8 bg-white", className)}>
      <NumberFieldInput
        aria-label={ariaLabel}
        className={cn("px-2 text-sm text-black", inputClassName)}
      />
    </NumberFieldGroup>
  </NumberField>
);
