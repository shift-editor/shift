import { useState } from "react";
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
}: SettingsNumberFieldProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <NumberField
      format={{ maximumFractionDigits: 20, useGrouping: false }}
      value={value}
      onValueChange={onValueChange}
      onValueCommitted={async () => {
        await onValueCommitted();
      }}
      disabled={disabled}
    >
      <NumberFieldGroup variant="plain" className={cn("h-8", className)}>
        <NumberFieldInput
          aria-label={ariaLabel}
          {...(!isFocused && { value: value === null ? "" : String(Number(value.toFixed(2))) })}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className={inputClassName}
        />
      </NumberFieldGroup>
    </NumberField>
  );
};
