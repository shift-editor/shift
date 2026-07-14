import { NumberField, NumberFieldGroup, NumberFieldInput, cn } from "@shift/ui";

interface SettingsNumberFieldProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  onValueCommitted: (value: number | null) => Promise<void>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

export const SettingsNumberField = ({
  value,
  onValueChange,
  onValueCommitted,
  ariaLabel,
  className,
  disabled,
}: SettingsNumberFieldProps) => (
  <NumberField
    value={value}
    onValueChange={onValueChange}
    onValueCommitted={onValueCommitted}
    disabled={disabled}
  >
    <NumberFieldGroup className={cn("h-8 bg-white", className)}>
      <NumberFieldInput aria-label={ariaLabel} className="px-2 text-xs" />
    </NumberFieldGroup>
  </NumberField>
);
