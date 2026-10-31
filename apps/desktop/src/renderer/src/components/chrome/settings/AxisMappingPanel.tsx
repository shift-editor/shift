import { useMemo, useState } from "react";
import { AxisMapping, type Axis } from "@shift/editor/model";
import { removeBy, type AxisMapping as AxisMappingRecord } from "@shift/types";
import { independentMappingFor } from "@shift/editor/variation";
import { Button, Tooltip } from "@shift/ui";
import { message } from "@shared/messages";
import MinusIcon from "@/assets/general/minus.svg";
import PlusIcon from "@/assets/general/plus.svg";
import { useSignalState } from "@shift/editor/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { MappingGraph } from "./MappingGraph";
import { SettingsNumberField } from "./SettingsNumberField";
import { useSettingsForm } from "./useSettingsForm";

interface AxisMappingPanelProps {
  axis: Axis;
}

export const AxisMappingPanel = ({ axis }: AxisMappingPanelProps) => {
  const font = useFont();
  const mappings = useSignalState(font.axisMappingsCell);
  const stored = independentMappingFor(mappings, axis);
  const [fallback] = useState(() => AxisMapping.identity(axis).record);
  const form = useSettingsForm<AxisMappingRecord>({
    canonical: stored ?? fallback,
    errorMessage: message("settings.mappingSaveFailed"),
    save: async (nextMapping) => {
      await font.setIndependentAxisMapping(axis, nextMapping);
      return independentMappingFor(font.getAxisMappings(), axis) ?? nextMapping;
    },
  });
  const draft = useMemo(() => new AxisMapping(form.draft, axis), [form.draft, axis]);
  const nextPoint = draft.nextPoint();

  const removePoint = async (index: number): Promise<void> => {
    if (form.form.getValues().points.length > 1) {
      await form.updateAndCommit((current) => new AxisMapping(current, axis).withoutPoint(index));
      return;
    }

    const next = removeBy(
      font.getAxisMappings(),
      form.form.getValues().id,
      (mapping) => mapping.id,
    );
    try {
      await font.setAxisMappings(next);
      form.form.reset(fallback);
    } catch (cause) {
      const errorMessage = message("settings.mappingSaveFailed");
      console.error(errorMessage, cause);
      form.form.setError("root.server", {
        type: "workspace",
        message: errorMessage,
      });
    }
  };

  return (
    <section className="grid grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.9fr)] gap-5 p-5 pr-8">
      <MappingGraph
        axis={axis}
        mapping={draft}
        onPointChange={(index, input, output) => {
          form.update((current) => new AxisMapping(current, axis).withPoint(index, input, output));
        }}
        onPointCommit={form.commit}
      />

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm text-primary">Source Mapping</h3>
        {form.error && <p className="text-xs text-error">{form.error}</p>}
        <div className="overflow-hidden rounded border border-line-subtle bg-surface">
          <table className="w-full table-fixed border-collapse text-center text-sm">
            <thead className="bg-input text-secondary">
              <tr>
                <th className="h-7 px-1 font-medium text-primary">User</th>
                <th className="h-7 px-1 font-medium text-primary">Source</th>
                <th className="w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {draft.coordinates.map(({ index, input, output }) => (
                <tr key={`${draft.record.id}:${index}`} className="group">
                  <MappingValueCell
                    label={`User mapping point ${index + 1}`}
                    value={input}
                    onChange={(value) =>
                      form.update((current) =>
                        new AxisMapping(current, axis).withPointInput(index, value),
                      )
                    }
                    onCommit={form.commit}
                  />
                  <MappingValueCell
                    label={`Source mapping point ${index + 1}`}
                    value={output}
                    onChange={(value) =>
                      form.update((current) =>
                        new AxisMapping(current, axis).withPointOutput(index, value),
                      )
                    }
                    onCommit={form.commit}
                  />
                  <td>
                    <Tooltip content={`Remove mapping point ${index + 1}`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mx-auto h-5 w-5 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-icon-button-hover"
                        aria-label={`Remove mapping point ${index + 1}`}
                        onClick={async () => {
                          await removePoint(index);
                        }}
                      >
                        <MinusIcon className="h-2.5 w-2.5" />
                      </Button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          className="self-start text-sm"
          disabled={nextPoint === null}
          onClick={async () => {
            await form.updateAndCommit((current) => new AxisMapping(current, axis).withNextPoint());
          }}
        >
          <PlusIcon className="h-2.5 w-2.5" />
          Add point
        </Button>
      </div>
    </section>
  );
};

interface MappingValueCellProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => Promise<void>;
}

const MappingValueCell = ({ label, value, onChange, onCommit }: MappingValueCellProps) => (
  <td className="p-0.5">
    <SettingsNumberField
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      onValueCommitted={onCommit}
      ariaLabel={label}
      className="h-6 bg-transparent"
      inputClassName="text-center"
    />
  </td>
);
