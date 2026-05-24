import { useEffect, useMemo, useState } from "react";
import { Button } from "@shift/ui";
import type { Axis, Source, SourceId } from "@shift/types";
import PlusIcon from "@/assets/plus.svg";
import { useSignalState } from "@/lib/signals";
import { getEditor, getWorkingCopy } from "@/store/store";
import { InfoField } from "./InfoField";

export const FontSourcesPanel = () => {
  const editor = getEditor();
  const sources = useSignalState(editor.font.sourcesCell);
  const axes = useMemo(() => editor.font.getAxes(), [editor]);
  const [selectedSourceId, setSelectedSourceId] = useState<SourceId | null>(
    () => sources[0]?.id ?? null,
  );

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  useEffect(() => {
    if (sources.length === 0) {
      setSelectedSourceId(null);
      return;
    }

    if (!selectedSourceId || !sources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(sources[0].id);
    }
  }, [selectedSourceId, sources]);

  const createSource = () => {
    const result = getWorkingCopy().commitMutation(() =>
      editor.font.createSource({
        name: nextSourceName(sources),
        location: { values: defaultLocationValues(axes) },
      }),
    );
    setSelectedSourceId(result.source.id);
  };

  return (
    <div className="grid min-h-[420px] grid-cols-[200px_minmax(0,1fr)] gap-5">
      <aside className="flex min-h-0 flex-col border-r border-line-subtle pr-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-primary">Sources</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Create source"
            title="Create source"
            onClick={createSource}
          >
            <PlusIcon className="h-3 w-3 text-muted" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-col gap-1 overflow-auto">
          {sources.map((source) => (
            <Button
              key={source.id}
              variant="ghost"
              size="sm"
              isActive={source.id === selectedSourceId}
              className="w-full justify-start truncate"
              onClick={() => setSelectedSourceId(source.id)}
            >
              <span className="truncate">{source.name}</span>
            </Button>
          ))}
        </div>
      </aside>

      <section className="min-w-0">
        {selectedSource ? (
          <SourceEditor key={selectedSource.id} source={selectedSource} axes={axes} />
        ) : null}
      </section>
    </div>
  );
};

interface SourceEditorProps {
  source: Source;
  axes: readonly Axis[];
}

const SourceEditor = ({ source, axes }: SourceEditorProps) => {
  const editor = getEditor();
  const [name, setName] = useState(source.name);
  const [locationDraft, setLocationDraft] = useState(() => sourceLocationDraft(source, axes));

  useEffect(() => {
    setName(source.name);
    setLocationDraft(sourceLocationDraft(source, axes));
  }, [axes, source]);

  const commitName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setName(source.name);
      return;
    }

    getWorkingCopy().commitMutation(() => {
      editor.font.updateSource({
        id: source.id,
        name: trimmed,
        location: source.location,
      });
    });
  };

  const commitAxis = (axis: Axis, value: string) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setLocationDraft(sourceLocationDraft(source, axes));
      return;
    }

    const nextLocation = {
      values: {
        ...sourceLocationValues(source, axes),
        [axis.tag]: parsed,
      },
    };

    getWorkingCopy().commitMutation(() => {
      editor.font.updateSource({
        id: source.id,
        name: source.name,
        location: nextLocation,
      });
    });
  };

  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
      <InfoField label="Name" value={name} onChange={setName} onCommit={commitName} />

      {axes.map((axis) => (
        <InfoField
          key={axis.tag}
          label={axis.name || axis.tag}
          value={locationDraft[axis.tag] ?? ""}
          onChange={(value) => setLocationDraft((current) => ({ ...current, [axis.tag]: value }))}
          onCommit={(value) => commitAxis(axis, value)}
          type="number"
        />
      ))}
    </div>
  );
};

function sourceLocationValues(source: Source, axes: readonly Axis[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const axis of axes) {
    values[axis.tag] = source.location.values[axis.tag] ?? axis.default;
  }
  return values;
}

function sourceLocationDraft(source: Source, axes: readonly Axis[]): Record<string, string> {
  const values = sourceLocationValues(source, axes);
  return Object.fromEntries(
    Object.entries(values).map(([axisTag, value]) => [axisTag, String(value)]),
  );
}

function defaultLocationValues(axes: readonly Axis[]): Record<string, number> {
  return Object.fromEntries(axes.map((axis) => [axis.tag, axis.default]));
}

function nextSourceName(sources: readonly Source[]): string {
  const names = new Set(sources.map((source) => source.name));
  if (!names.has("Source")) return "Source";

  for (let index = 1; ; index += 1) {
    const candidate = `Source ${index}`;
    if (!names.has(candidate)) return candidate;
  }
}
