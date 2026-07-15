import { useState } from "react";
import type { Axis, AxisMapping, AxisMappingPoint } from "@shift/types";
import { mintAxisMappingId } from "@shift/types";
import { Button } from "@shift/ui";
import MinusIcon from "@/assets/minus.svg";
import PlusIcon from "@/assets/plus.svg";
import { useSignalState } from "@/lib/signals";
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
  const stored = independentMappingForAxis(mappings, axis);
  const [fallback] = useState(() => identityMapping(axis));
  const form = useSettingsForm<AxisMapping>({
    canonical: stored ?? fallback,
    errorMessage: "Unable to update the mapping",
    save: async (nextMapping) => {
      const current = font.getAxisMappings();
      const index = current.findIndex(
        (mapping) =>
          mapping.id === nextMapping.id || independentMappingForAxis([mapping], axis) !== null,
      );
      const next = [...current];
      if (index === -1) next.push(nextMapping);
      else next[index] = nextMapping;

      await font.setAxisMappings(next);
      return independentMappingForAxis(font.getAxisMappings(), axis) ?? nextMapping;
    },
  });
  const draft = form.draft;
  const nextPoint = nextMappingPoint(axis, draft);

  const updatePoint = (index: number, side: "input" | "output", value: number) => {
    form.update((current) => ({
      ...current,
      points: current.points.map((point, pointIndex) => {
        if (pointIndex !== index) return point;

        return {
          ...point,
          [side]: {
            values: { ...point[side].values, [axis.id]: value },
          },
        };
      }),
    }));
  };

  const removePoint = async (index: number): Promise<void> => {
    if (form.form.getValues().points.length > 1) {
      await form.updateAndCommit((current) => ({
        ...current,
        points: current.points.filter((_, pointIndex) => pointIndex !== index),
      }));
      return;
    }

    const next = font
      .getAxisMappings()
      .filter((mapping) => mapping.id !== form.form.getValues().id);
    try {
      await font.setAxisMappings(next);
      form.form.reset(fallback);
    } catch (cause) {
      form.form.setError("root.server", {
        type: "workspace",
        message: cause instanceof Error ? cause.message : "Unable to remove the mapping",
      });
    }
  };

  return (
    <section className="grid grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.9fr)] gap-5 p-5 pr-8">
      <MappingGraph axis={axis} points={draft.points} />

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm text-primary">Source Mapping</h3>
        {form.error && <p className="text-xs text-red-600">{form.error}</p>}
        <div className="overflow-hidden rounded border border-line-subtle bg-white">
          <table className="w-full table-fixed border-collapse text-center text-sm">
            <thead className="bg-input text-secondary">
              <tr>
                <th className="h-7 px-1 font-medium text-black">User</th>
                <th className="h-7 px-1 font-medium text-black">Source</th>
                <th className="w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {draft.points.map((point, index) => (
                <tr key={`${draft.id}:${index}`} className="group">
                  <MappingValueCell
                    label={`User mapping point ${index + 1}`}
                    value={point.input.values[axis.id] ?? axis.default}
                    onChange={(value) => updatePoint(index, "input", value)}
                    onCommit={form.commit}
                  />
                  <MappingValueCell
                    label={`Source mapping point ${index + 1}`}
                    value={point.output.values[axis.id] ?? axis.default}
                    onChange={(value) => updatePoint(index, "output", value)}
                    onCommit={form.commit}
                  />
                  <td>
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
          className="h-7 self-start px-2 text-sm"
          disabled={nextPoint === null}
          onClick={async () => {
            await form.updateAndCommit((current) => {
              const point = nextMappingPoint(axis, current);
              if (!point) return current;

              return {
                ...current,
                points: [...current.points, point].sort(
                  (left, right) => mappingInput(left, axis) - mappingInput(right, axis),
                ),
              };
            });
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

function independentMappingForAxis(
  mappings: readonly AxisMapping[],
  axis: Axis,
): AxisMapping | null {
  return (
    mappings.find(
      (mapping) =>
        mapping.inputs.length === 1 &&
        mapping.outputs.length === 1 &&
        mapping.inputs[0] === axis.id &&
        mapping.outputs[0] === axis.id,
    ) ?? null
  );
}

function identityMapping(axis: Axis): AxisMapping {
  const values = axis.values ?? [
    axis.minimum ?? axis.default,
    axis.default,
    axis.maximum ?? axis.default,
  ];
  const unique = [...new Set(values)].sort((left, right) => left - right);
  return {
    id: mintAxisMappingId(),
    name: `${axis.name} mapping`,
    inputs: [axis.id],
    outputs: [axis.id],
    points: unique.map((value) => mappingPoint(axis, value, value)),
  };
}

function mappingPoint(axis: Axis, input: number, output: number): AxisMappingPoint {
  return {
    input: { values: { [axis.id]: input } },
    output: { values: { [axis.id]: output } },
  };
}

function nextMappingPoint(axis: Axis, mapping: AxisMapping): AxisMappingPoint | null {
  const coordinates = mapping.points
    .map((point) => ({
      input: point.input.values[axis.id],
      output: point.output.values[axis.id],
    }))
    .filter(
      (point): point is { input: number; output: number } =>
        point.input !== undefined && point.output !== undefined,
    )
    .sort((left, right) => left.input - right.input);
  const inputs = new Set(coordinates.map(({ input }) => input));

  if (axis.axisType === "discrete") {
    const input = axis.values?.find((value) => !inputs.has(value));
    if (input === undefined) return null;

    return mappingPoint(axis, input, interpolateMapping(coordinates, input));
  }

  const minimum = axis.minimum ?? axis.default;
  const maximum = axis.maximum ?? axis.default;
  const preferred = [axis.default, minimum, maximum].find((value) => !inputs.has(value));
  if (preferred !== undefined) {
    return mappingPoint(axis, preferred, interpolateMapping(coordinates, preferred));
  }

  const ordered = [...inputs]
    .filter((value) => minimum <= value && value <= maximum)
    .sort((left, right) => left - right);
  let largestGap = 0;
  let input: number | null = null;

  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    const gap = right - left;
    const midpoint = left + gap / 2;
    if (gap <= largestGap || midpoint === left || midpoint === right) continue;

    largestGap = gap;
    input = midpoint;
  }

  if (input === null) return null;
  return mappingPoint(axis, input, interpolateMapping(coordinates, input));
}

function interpolateMapping(
  coordinates: readonly { input: number; output: number }[],
  input: number,
): number {
  const first = coordinates[0];
  if (!first || input <= first.input) return first?.output ?? input;

  const last = coordinates.at(-1);
  if (!last || input >= last.input) return last?.output ?? input;

  for (let index = 1; index < coordinates.length; index += 1) {
    const right = coordinates[index];
    if (input > right.input) continue;

    const left = coordinates[index - 1];
    const progress = (input - left.input) / (right.input - left.input);
    return left.output + progress * (right.output - left.output);
  }

  return input;
}

function mappingInput(point: AxisMappingPoint, axis: Axis): number {
  return point.input.values[axis.id] ?? axis.default;
}
