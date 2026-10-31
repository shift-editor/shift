import { Axis } from "@shift/editor/model";
import type { AxisKindName } from "@shift/types";
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
import { isRegisteredOpenTypeAxisTag } from "@/lib/variation/registeredAxes";
import { SettingsNumberField } from "./SettingsNumberField";
import type { AxisDraft } from "./types";

interface AxisDefinitionPanelProps {
  draft: AxisDraft;
}

export const AxisDefinitionPanel = ({ draft }: AxisDefinitionPanelProps) => {
  const axis = draft.axis;
  const registeredTag = isRegisteredOpenTypeAxisTag(axis.tag);

  const changeType = async (axisType: AxisKindName | null): Promise<void> => {
    if (!axisType || axisType === axis.kind.kind) return;

    await draft.updateAndCommit((current) => new Axis(current).withKind(axisType));
  };

  return (
    <section className="flex flex-col gap-5 p-5 pr-8">
      {draft.error && <p className="text-xs text-error">{draft.error}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-primary">
          Name
          <Input
            value={axis.name}
            onChange={(event) => {
              const name = event.currentTarget.value;
              draft.update((current) => new Axis(current).withName(name));
            }}
            onBlur={async () => {
              await draft.commit();
            }}
            size="md"
            variant="plain"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-secondary">
          Tag
          <Input
            value={axis.tag}
            disabled={registeredTag}
            onChange={(event) => {
              const tag = event.currentTarget.value;
              draft.update((current) => new Axis(current).withTag(tag));
            }}
            onBlur={async () => {
              await draft.commit();
            }}
            size="md"
            variant={registeredTag ? "filled" : "plain"}
            className="font-mono"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-primary">Values</h3>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_7rem] gap-2">
          <DefinitionNumberField
            label="Minimum"
            value={axis.minimum}
            disabled={axis.isDiscrete}
            onChange={(minimum) =>
              draft.update((current) => new Axis(current).withMinimum(minimum))
            }
            onCommit={draft.commit}
          />
          <DefinitionNumberField
            label="Default"
            value={axis.default}
            onChange={(value) => draft.update((current) => new Axis(current).withDefault(value))}
            onCommit={draft.commit}
          />
          <DefinitionNumberField
            label="Maximum"
            value={axis.maximum}
            disabled={axis.isDiscrete}
            onChange={(maximum) =>
              draft.update((current) => new Axis(current).withMaximum(maximum))
            }
            onCommit={draft.commit}
          />

          <label className="flex flex-col gap-1.5 text-sm text-secondary">
            Type
            <Select value={axis.kind.kind} onValueChange={changeType}>
              <SelectTrigger variant="plain" className="h-8">
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

      <label className="flex items-center gap-2 text-sm text-primary">
        <Checkbox
          checked={axis.hidden}
          onCheckedChange={async (hidden) => {
            await draft.updateAndCommit((current) => new Axis(current).withHidden(hidden));
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
  <label className="flex flex-col gap-1.5 text-sm text-secondary">
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
