import {
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@shift/ui";

/** A sidebar select over a fixed set of values, each shown by its label. */
export function LabelledSelect<Value extends string>({
  label,
  value,
  labels,
  onChange,
  hideLabel = false,
}: {
  readonly label: string;
  readonly value: Value;
  readonly labels: Record<Value, string>;
  readonly onChange: (value: Value) => void;
  readonly hideLabel?: boolean;
}) {
  const options = Object.keys(labels) as Value[];
  return (
    <label className="flex w-full min-w-0 flex-col gap-1">
      {hideLabel ? null : <span className="text-ui text-secondary">{label}</span>}
      <Select
        value={value}
        items={labels}
        onValueChange={(next) => {
          if (next !== null) onChange(next as Value);
        }}
      >
        <SelectTrigger aria-label={label} className="h-6 w-full">
          <SelectValue />
          <SelectIcon />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner sideOffset={4}>
            <SelectPopup>
              <SelectList>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    <SelectItemIndicator />
                    <SelectItemText>{labels[option]}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </label>
  );
}
