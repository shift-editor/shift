import type { Axis, AxisType } from "@shift/types";
import {
  Checkbox,
  Input,
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
import { SettingsNumberField } from "./SettingsNumberField";
import type { AxisDraft } from "./types";

interface AxisDefinitionPanelProps {
  draft: AxisDraft;
}

export const AxisDefinitionPanel = ({ draft }: AxisDefinitionPanelProps) => {
  const axis = draft.axis;

  const changeType = async (axisType: AxisType | null): Promise<void> => {
    if (!axisType || axisType === axis.axisType) return;

    await draft.updateAndCommit((current) => axisWithType(current, axisType));
  };

  return (
    <section className="flex flex-col gap-5 p-3">
      {draft.error && <p className="text-xs text-red-600">{draft.error}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-primary">
          Name
          <Input
            value={axis.name}
            onChange={(event) => {
              const name = event.currentTarget.value;
              draft.update((current) => ({ ...current, name }));
            }}
            onBlur={async () => {
              await draft.commit();
            }}
            className="h-8 bg-white text-xs"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-secondary">
          Tag
          <Input value={axis.tag} readOnly className="h-8 bg-input text-xs text-secondary" />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-primary">Values</h3>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_7rem] gap-2">
          <DefinitionNumberField
            label="Minimum"
            value={axis.minimum ?? axis.default}
            disabled={axis.axisType === "discrete"}
            onChange={(minimum) => draft.update((current) => ({ ...current, minimum }))}
            onCommit={draft.commit}
          />
          <DefinitionNumberField
            label="Default"
            value={axis.default}
            onChange={(value) => draft.update((current) => ({ ...current, default: value }))}
            onCommit={draft.commit}
          />
          <DefinitionNumberField
            label="Maximum"
            value={axis.maximum ?? axis.default}
            disabled={axis.axisType === "discrete"}
            onChange={(maximum) => draft.update((current) => ({ ...current, maximum }))}
            onCommit={draft.commit}
          />

          <label className="flex flex-col gap-1.5 text-xs text-secondary">
            Type
            <Select value={axis.axisType} onValueChange={changeType}>
              <SelectTrigger className="h-8 bg-white text-xs">
                <SelectValue />
                <SelectIcon />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner sideOffset={4}>
                  <SelectPopup>
                    <SelectList>
                      <SelectItem value="continuous">
                        <SelectItemIndicator />
                        <SelectItemText>Continuous</SelectItemText>
                      </SelectItem>
                      <SelectItem value="discrete">
                        <SelectItemIndicator />
                        <SelectItemText>Discrete</SelectItemText>
                      </SelectItem>
                    </SelectList>
                  </SelectPopup>
                </SelectPositioner>
              </SelectPortal>
            </Select>
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-primary">
        <Checkbox
          checked={axis.hidden}
          onCheckedChange={async (hidden) => {
            await draft.updateAndCommit((current) => ({ ...current, hidden }));
          }}
          aria-label="Hidden axis"
        />
        Hidden
      </label>
    </section>
  );
};

interface DefinitionNumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => Promise<void>;
  disabled?: boolean;
}

const DefinitionNumberField = ({
  label,
  value,
  onChange,
  onCommit,
  disabled,
}: DefinitionNumberFieldProps) => (
  <label className="flex flex-col gap-1.5 text-xs text-secondary">
    {label}
    <SettingsNumberField
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      onValueCommitted={onCommit}
      ariaLabel={label}
      disabled={disabled}
    />
  </label>
);

function axisWithType(axis: Axis, axisType: AxisType): Axis {
  switch (axisType) {
    case "continuous": {
      const values = axis.values ?? [axis.default];
      return {
        ...axis,
        axisType,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        values: undefined,
      };
    }
    case "discrete": {
      const values = [...new Set([axis.minimum, axis.default, axis.maximum])]
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right);
      return { ...axis, axisType, minimum: undefined, maximum: undefined, values };
    }
  }
}
