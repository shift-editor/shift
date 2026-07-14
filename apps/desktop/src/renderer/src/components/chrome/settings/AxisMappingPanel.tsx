import { useCallback, useEffect, useRef, useState } from "react";
import type { Axis, AxisMapping, AxisMappingPoint } from "@shift/types";
import { mintAxisMappingId } from "@shift/types";
import { Button } from "@shift/ui";
import MinusIcon from "@/assets/minus.svg";
import PlusIcon from "@/assets/plus.svg";
import { useSignalState } from "@/lib/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { MappingGraph } from "./MappingGraph";
import { SettingsNumberField } from "./SettingsNumberField";

interface AxisMappingPanelProps {
  axis: Axis;
}

export const AxisMappingPanel = ({ axis }: AxisMappingPanelProps) => {
  const font = useFont();
  const mappings = useSignalState(font.axisMappingsCell);
  const stored = independentMappingForAxis(mappings, axis);
  const [draft, setDraft] = useState(() => stored ?? identityMapping(axis));
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const pendingRef = useRef(0);

  useEffect(() => {
    if (pendingRef.current > 0) return;

    const next = stored ?? identityMapping(axis);
    draftRef.current = next;
    setDraft(next);
    setError(null);
  }, [axis, stored]);

  const replaceDraft = useCallback((next: AxisMapping) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const commit = useCallback(
    async (candidate?: AxisMapping): Promise<void> => {
      const nextMapping = candidate ?? draftRef.current;
      const current = font.getAxisMappings();
      const index = current.findIndex(
        (mapping) =>
          mapping.id === nextMapping.id || independentMappingForAxis([mapping], axis) !== null,
      );
      const next = [...current];
      if (index === -1) next.push(nextMapping);
      else next[index] = nextMapping;
      pendingRef.current += 1;
      setError(null);

      try {
        await font.setAxisMappings(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to update the mapping");
      } finally {
        pendingRef.current -= 1;
      }
    },
    [axis, font],
  );

  const updatePoint = (index: number, side: "input" | "output", value: number) => {
    const points = draftRef.current.points.map((point, pointIndex) => {
      if (pointIndex !== index) return point;

      return {
        ...point,
        [side]: {
          values: { ...point[side].values, [axis.id]: value },
        },
      };
    });
    replaceDraft({ ...draftRef.current, points });
  };

  const removePoint = async (index: number): Promise<void> => {
    if (draftRef.current.points.length > 1) {
      const next = {
        ...draftRef.current,
        points: draftRef.current.points.filter((_, pointIndex) => pointIndex !== index),
      };
      replaceDraft(next);
      await commit(next);
      return;
    }

    const next = font.getAxisMappings().filter((mapping) => mapping.id !== draftRef.current.id);
    try {
      await font.setAxisMappings(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove the mapping");
    }
  };

  return (
    <section className="grid grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.9fr)] gap-3 p-3">
      <MappingGraph axis={axis} points={draft.points} />

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-xs text-primary">Source Mapping</h3>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="overflow-hidden rounded border border-line-subtle bg-white">
          <table className="w-full table-fixed border-collapse text-[11px]">
            <thead className="bg-input text-secondary">
              <tr>
                <th className="h-7 px-1 font-medium">User</th>
                <th className="h-7 px-1 font-medium">Source</th>
                <th className="w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {draft.points.map((point, index) => (
                <tr key={mappingPointKey(point, axis, index)}>
                  <MappingValueCell
                    label={`User mapping point ${index + 1}`}
                    value={point.input.values[axis.id] ?? axis.default}
                    onChange={(value) => updatePoint(index, "input", value)}
                    onCommit={commit}
                  />
                  <MappingValueCell
                    label={`Source mapping point ${index + 1}`}
                    value={point.output.values[axis.id] ?? axis.default}
                    onChange={(value) => updatePoint(index, "output", value)}
                    onCommit={commit}
                  />
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mx-auto h-5 w-5 text-muted"
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
          className="h-7 self-start px-2 text-[11px]"
          onClick={async () => {
            const point = mappingPoint(axis, axis.default, axis.default);
            const next = { ...draftRef.current, points: [...draftRef.current.points, point] };
            replaceDraft(next);
            await commit(next);
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

function mappingPointKey(point: AxisMappingPoint, axis: Axis, index: number): string {
  return `${point.input.values[axis.id]}:${point.output.values[axis.id]}:${index}`;
}
