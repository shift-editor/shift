import { useEffect, useState, type ReactNode } from "react";
import type { Axis, MetricDefinition, Source, SourceId, SourceMetricValue } from "@shift/types";
import { Button, Input, cn } from "@shift/ui";
import MinusIcon from "@/assets/minus.svg";
import PlusIcon from "@/assets/plus.svg";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar/SidebarActionRow";
import { useAxes } from "@/hooks/useAxes";
import { useSignalState } from "@/lib/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import { SettingsNumberField } from "./SettingsNumberField";
import { useSettingsForm } from "./useSettingsForm";

interface SourcesSettingsPanelProps {
  onCreateSource: () => void;
  initialSourceId?: SourceId;
}

export const SourcesSettingsPanel = ({
  onCreateSource,
  initialSourceId,
}: SourcesSettingsPanelProps) => {
  const font = useFont();
  const axes = useAxes();
  const sources = useSignalState(font.sourcesCell);
  const definitions = useSignalState(font.metricDefinitionsCell);
  const [selectedSourceId, setSelectedSourceId] = useState(
    initialSourceId ?? sources[0]?.id ?? null,
  );

  useEffect(() => {
    if (selectedSourceId && sources.some((source) => source.id === selectedSourceId)) return;

    setSelectedSourceId(sources[0]?.id ?? null);
  }, [selectedSourceId, sources]);

  const selectedSource =
    sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[10rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-r-toolbar bg-canvas">
        <div className="flex h-11 shrink-0 items-center justify-between px-2">
          <h2 className="pl-1 text-sm font-medium text-primary">Sources</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Add source"
            onClick={onCreateSource}
          >
            <PlusIcon className="h-3 w-3" />
          </Button>
        </div>

        <div className="scrollbar-hidden min-h-0 overflow-y-auto px-2 pb-2">
          {sources.map((source) => (
            <SidebarActionRow
              key={source.id}
              isActive={source.id === selectedSource?.id}
              className={cn(
                "h-8",
                source.id === selectedSource?.id &&
                  "bg-hover hover:bg-hover data-[active]:bg-hover",
              )}
              onClick={() => setSelectedSourceId(source.id)}
              contentClassName="h-8 text-sm font-normal"
              actions={
                <SidebarActionButton
                  label={`Delete ${source.name}`}
                  className="h-8 hover:bg-icon-button-hover"
                  disabled={sources.length === 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    font.deleteSource(source.id);
                  }}
                >
                  <MinusIcon className="h-3 w-3" />
                </SidebarActionButton>
              }
            >
              <span className="truncate">{source.name}</span>
            </SidebarActionRow>
          ))}
        </div>
      </aside>

      {selectedSource ? (
        <SourceEditor
          key={selectedSource.id}
          source={selectedSource}
          axes={axes}
          definitions={definitions}
        />
      ) : (
        <div className="grid place-items-center text-xs text-secondary">No sources</div>
      )}
    </div>
  );
};

interface SourceEditorProps {
  source: Source;
  axes: readonly Axis[];
  definitions: readonly MetricDefinition[];
}

const SourceEditor = ({ source, axes, definitions }: SourceEditorProps) => {
  const font = useFont();
  const form = useSettingsForm<Source>({
    canonical: source,
    errorMessage: "Unable to update source",
    save: async (next) => {
      await font.updateSource(next);
      return font.source(next.id) ?? next;
    },
  });
  const draft = form.draft;
  const commit = async (): Promise<void> => {
    await form.commit();
  };

  return (
    <section className="scrollbar-hidden min-h-0 overflow-y-auto p-5 pr-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium text-primary">{draft.name || "Source"}</h2>
      </div>

      {form.error && <p className="mb-4 text-xs text-red-600">{form.error}</p>}

      <SettingsSection title="Name">
        <Input
          value={draft.name}
          onChange={(event) => {
            const name = event.currentTarget.value;
            form.update((current) => ({ ...current, name }));
          }}
          onBlur={commit}
          className="h-8 bg-white text-sm text-black"
        />
      </SettingsSection>

      {axes.length > 0 && (
        <SettingsSection title="Axes">
          <div className="grid grid-cols-2 gap-3">
            {axes.map((axis) => (
              <SourceNumberField
                key={axis.id}
                label={axis.name}
                value={draft.location.values[axis.id] ?? axis.default}
                onChange={(value) => {
                  form.update((current) => ({
                    ...current,
                    location: {
                      values: { ...current.location.values, [axis.id]: value },
                    },
                  }));
                }}
                onCommit={commit}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Metrics">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
          {definitions.map((definition) => {
            const value = metricValue(draft, definition);
            return (
              <MetricFields
                key={definition.id}
                definition={definition}
                value={value}
                onChange={(next) => {
                  form.update((current) => ({
                    ...current,
                    metricValues: replaceMetricValue(current.metricValues, next),
                  }));
                }}
                onCommit={commit}
              />
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Technical">
        <div className="grid grid-cols-2 gap-3">
          <OptionalSourceNumberField
            label="Italic Angle"
            value={draft.italicAngle}
            onChange={(italicAngle) => form.update((current) => ({ ...current, italicAngle }))}
            onCommit={commit}
          />
          <OptionalSourceNumberField
            label="Line Gap"
            value={draft.lineGap}
            onChange={(lineGap) => form.update((current) => ({ ...current, lineGap }))}
            onCommit={commit}
          />
          <OptionalSourceNumberField
            label="Underline Position"
            value={draft.underlinePosition}
            onChange={(underlinePosition) =>
              form.update((current) => ({ ...current, underlinePosition }))
            }
            onCommit={commit}
          />
          <OptionalSourceNumberField
            label="Underline Thickness"
            value={draft.underlineThickness}
            onChange={(underlineThickness) =>
              form.update((current) => ({ ...current, underlineThickness }))
            }
            onCommit={commit}
          />
        </div>
      </SettingsSection>
    </section>
  );
};

const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mb-5 flex flex-col gap-2">
    <h3 className="text-sm font-medium text-primary">{title}</h3>
    {children}
  </div>
);

interface MetricFieldsProps {
  definition: MetricDefinition;
  value: SourceMetricValue;
  onChange: (value: SourceMetricValue) => void;
  onCommit: () => Promise<void>;
}

const MetricFields = ({ definition, value, onChange, onCommit }: MetricFieldsProps) => (
  <>
    <SourceNumberField
      label={definition.name}
      value={value.position}
      onChange={(position) => onChange({ ...value, position })}
      onCommit={onCommit}
    />
    <SourceNumberField
      label="Overshoot"
      value={value.overshoot}
      onChange={(overshoot) => onChange({ ...value, overshoot })}
      onCommit={onCommit}
    />
  </>
);

interface SourceNumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => Promise<void>;
}

const SourceNumberField = ({ label, value, onChange, onCommit }: SourceNumberFieldProps) => (
  <label className="flex flex-col gap-1.5 text-sm text-secondary">
    {label}
    <SettingsNumberField
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      onValueCommitted={onCommit}
      ariaLabel={label}
    />
  </label>
);

interface OptionalSourceNumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  onCommit: () => Promise<void>;
}

const OptionalSourceNumberField = ({
  label,
  value,
  onChange,
  onCommit,
}: OptionalSourceNumberFieldProps) => (
  <label className="flex flex-col gap-1.5 text-sm text-secondary">
    {label}
    <SettingsNumberField
      value={value ?? null}
      onValueChange={(next) => onChange(next ?? undefined)}
      onValueCommitted={onCommit}
      ariaLabel={label}
    />
  </label>
);

function metricValue(source: Source, definition: MetricDefinition): SourceMetricValue {
  return (
    source.metricValues.find((value) => value.metricId === definition.id) ?? {
      metricId: definition.id,
      position: 0,
      overshoot: 0,
    }
  );
}

function replaceMetricValue(
  values: readonly SourceMetricValue[],
  replacement: SourceMetricValue,
): SourceMetricValue[] {
  const index = values.findIndex((value) => value.metricId === replacement.metricId);
  if (index < 0) return [...values, replacement];

  const next = [...values];
  next[index] = replacement;
  return next;
}
