import { useEffect, useState, type ReactNode } from "react";
import type { Axis, NamedInstance, NamedInstanceId } from "@shift/types";
import { Input, cn } from "@shift/ui";
import MinusIcon from "@/assets/general/minus.svg";
import { SidebarActionButton, SidebarActionRow } from "@/components/sidebar/SidebarActionRow";
import { CreateInstanceMenu } from "@/components/variation/CreateInstanceMenu";
import { useAxes } from "@/hooks/useAxes";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { useFont } from "@/workspace/WorkspaceContext";
import { SettingsNumberField } from "./SettingsNumberField";
import { useSettingsForm } from "./useSettingsForm";

interface InstancesSettingsPanelProps {
  initialInstanceId?: NamedInstanceId;
}

export const InstancesSettingsPanel = ({ initialInstanceId }: InstancesSettingsPanelProps) => {
  const font = useFont();
  const instances = useNamedInstances();
  const axes = useAxes().filter((axis) => axis.role === "external");
  const [selectedInstanceId, setSelectedInstanceId] = useState<NamedInstanceId | null>(
    initialInstanceId ?? instances[0]?.id ?? null,
  );
  const [pendingInstanceId, setPendingInstanceId] = useState<NamedInstanceId | null>(null);

  useEffect(() => {
    if (pendingInstanceId) {
      if (!instances.some((instance) => instance.id === pendingInstanceId)) return;

      setSelectedInstanceId(pendingInstanceId);
      setPendingInstanceId(null);
      return;
    }
    if (selectedInstanceId && instances.some((instance) => instance.id === selectedInstanceId)) {
      return;
    }

    setSelectedInstanceId(instances[0]?.id ?? null);
  }, [instances, pendingInstanceId, selectedInstanceId]);

  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId) ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[10rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-r-toolbar bg-canvas">
        <div className="flex h-11 shrink-0 items-center justify-between px-2">
          <h2 className="pl-1 text-sm font-medium text-primary">Instances</h2>
          <CreateInstanceMenu onInstanceCreated={setPendingInstanceId} />
        </div>

        <div className="scrollbar-hidden min-h-0 overflow-y-auto px-2 pb-2">
          {instances.map((instance) => (
            <SidebarActionRow
              key={instance.id}
              isActive={instance.id === selectedInstance?.id}
              className={cn(
                "h-8",
                instance.id === selectedInstance?.id &&
                  "bg-hover hover:bg-hover data-[active]:bg-hover",
              )}
              onClick={() => setSelectedInstanceId(instance.id)}
              contentClassName="h-8 text-sm font-normal"
              actions={
                <SidebarActionButton
                  label={`Delete ${instance.name}`}
                  className="h-8 hover:bg-icon-button-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    font.deleteNamedInstance(instance.id);
                  }}
                >
                  <MinusIcon className="h-3 w-3" />
                </SidebarActionButton>
              }
            >
              <span className="truncate">{instance.name}</span>
            </SidebarActionRow>
          ))}
        </div>
      </aside>

      {selectedInstance ? (
        <InstanceEditor key={selectedInstance.id} instance={selectedInstance} axes={axes} />
      ) : (
        <InstancesEmptyState hasAxes={axes.length > 0} />
      )}
    </div>
  );
};

interface InstanceEditorProps {
  instance: NamedInstance;
  axes: readonly Axis[];
}

const InstanceEditor = ({ instance, axes }: InstanceEditorProps) => {
  const font = useFont();
  const form = useSettingsForm<NamedInstance>({
    canonical: instance,
    errorMessage: "Unable to update instance",
    save: async (next) => {
      await font.updateNamedInstance(next);
      return font.namedInstances.find((candidate) => candidate.id === next.id) ?? next;
    },
  });
  const draft = form.draft;
  const commit = async (): Promise<void> => {
    await form.commit();
  };

  return (
    <section className="scrollbar-hidden min-h-0 overflow-y-auto p-5 pr-8">
      <div className="mb-5 flex h-6 items-center">
        <h2 className="truncate text-sm font-medium text-primary">{draft.name || "Instance"}</h2>
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

      <SettingsSection title="Location">
        <div className="flex flex-col gap-2">
          {axes.map((axis) => (
            <InstanceNumberField
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
    </section>
  );
};

const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mb-5 flex flex-col gap-2">
    <h3 className="text-ui font-medium text-primary">{title}</h3>
    {children}
  </div>
);

interface InstanceNumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => Promise<void>;
}

const InstanceNumberField = ({ label, value, onChange, onCommit }: InstanceNumberFieldProps) => (
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

const InstancesEmptyState = ({ hasAxes }: { hasAxes: boolean }) => (
  <div className="flex items-center justify-center px-8 text-center text-xs text-secondary">
    {hasAxes
      ? "Create an instance to define a named product location."
      : "Add an axis to create instances."}
  </div>
);
