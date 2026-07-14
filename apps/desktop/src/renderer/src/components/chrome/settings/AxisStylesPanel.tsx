import type { ReactNode } from "react";
import type { Axis, AxisLabel, AxisLabelId } from "@shift/types";
import { mintAxisLabelId } from "@shift/types";
import { Button, Checkbox, Input } from "@shift/ui";
import MinusIcon from "@/assets/minus.svg";
import PlusIcon from "@/assets/plus.svg";
import { SettingsNumberField } from "./SettingsNumberField";
import type { AxisDraft } from "./types";

interface AxisStylesPanelProps {
  draft: AxisDraft;
}

export const AxisStylesPanel = ({ draft }: AxisStylesPanelProps) => {
  const valueLabels = draft.axis.labels.filter((label) => !isRangeLabel(label));
  const rangeLabels = draft.axis.labels.filter(isRangeLabel);
  const labelsDisabled = draft.axis.role === "internal";

  return (
    <section className="flex flex-col gap-5 p-3">
      <div>
        <h3 className="text-xs font-medium text-primary">Axes Styles</h3>
        {labelsDisabled && (
          <p className="mt-1 text-xs text-secondary">Internal axes cannot own external labels.</p>
        )}
        {draft.error && <p className="mt-1 text-xs text-red-600">{draft.error}</p>}
      </div>

      <StyleSection
        title="Value"
        onAdd={async () => {
          await addLabel(draft, false);
        }}
        disabled={labelsDisabled}
      >
        <ValueLabelsTable labels={valueLabels} draft={draft} />
      </StyleSection>

      <StyleSection
        title="Range"
        onAdd={async () => {
          await addLabel(draft, true);
        }}
        disabled={labelsDisabled}
      >
        <RangeLabelsTable labels={rangeLabels} draft={draft} />
      </StyleSection>
    </section>
  );
};

interface StyleSectionProps {
  title: string;
  onAdd: () => Promise<void>;
  disabled: boolean;
  children: ReactNode;
}

const StyleSection = ({ title, onAdd, disabled, children }: StyleSectionProps) => (
  <div className="flex flex-col gap-2">
    <h4 className="text-xs text-primary">{title}</h4>
    {children}
    <Button
      type="button"
      variant="primary"
      size="sm"
      className="h-7 self-start px-2 text-[11px]"
      disabled={disabled}
      onClick={onAdd}
    >
      <PlusIcon className="h-2.5 w-2.5" />
      Add style
    </Button>
  </div>
);

const ValueLabelsTable = ({ labels, draft }: { labels: AxisLabel[]; draft: AxisDraft }) => (
  <StyleTable headings={["Name", "Value", "Linked", "Elidable", ""]}>
    {labels.map(({ value: labelValue, ...rest }) => {
      const label = { ...rest, value: labelValue };
      return (
        <tr key={label.id}>
          <NameCell label={label} draft={draft} />
          <NumberCell
            label={`${label.name} value`}
            value={labelValue}
            onChange={(value) => {
              if (value !== null) {
                updateLabelDraft(draft, label.id, (item) => ({ ...item, value }));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} linked value`}
            value={label.linkedValue ?? null}
            optional
            onChange={(linkedValue) =>
              updateLabelDraft(draft, label.id, (item) => ({
                ...item,
                linkedValue: linkedValue ?? undefined,
              }))
            }
            onCommit={draft.commit}
          />
          <ElidableCell label={label} draft={draft} />
          <RemoveCell label={label} draft={draft} />
        </tr>
      );
    })}
  </StyleTable>
);

const RangeLabelsTable = ({ labels, draft }: { labels: AxisLabel[]; draft: AxisDraft }) => (
  <StyleTable headings={["Name", "Default", "Min", "Max", "Elidable", ""]}>
    {labels.map(({ value: labelValue, ...rest }) => {
      const label = { ...rest, value: labelValue };
      return (
        <tr key={label.id}>
          <NameCell label={label} draft={draft} />
          <NumberCell
            label={`${label.name} default`}
            value={labelValue}
            onChange={(value) => {
              if (value !== null) {
                updateLabelDraft(draft, label.id, (item) => ({ ...item, value }));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} minimum`}
            value={label.minimum ?? labelValue}
            onChange={(minimum) => {
              if (minimum !== null) {
                updateLabelDraft(draft, label.id, (item) => ({ ...item, minimum }));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} maximum`}
            value={label.maximum ?? labelValue}
            onChange={(maximum) => {
              if (maximum !== null) {
                updateLabelDraft(draft, label.id, (item) => ({ ...item, maximum }));
              }
            }}
            onCommit={draft.commit}
          />
          <ElidableCell label={label} draft={draft} />
          <RemoveCell label={label} draft={draft} />
        </tr>
      );
    })}
  </StyleTable>
);

const StyleTable = ({ headings, children }: { headings: string[]; children: ReactNode }) => (
  <div className="overflow-hidden rounded border border-line-subtle bg-white">
    <table className="w-full table-fixed border-collapse text-[11px]">
      <thead className="bg-input text-secondary">
        <tr>
          {headings.map((heading, index) => (
            <th key={`${heading}-${index}`} className="h-7 px-1 text-center font-medium">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line-subtle">{children}</tbody>
    </table>
  </div>
);

const NameCell = ({ label, draft }: { label: AxisLabel; draft: AxisDraft }) => (
  <td className="p-0.5">
    <Input
      value={label.name}
      onChange={(event) => {
        const name = event.currentTarget.value;
        updateLabelDraft(draft, label.id, (item) => ({ ...item, name }));
      }}
      onBlur={async () => {
        await draft.commit();
      }}
      className="h-6 bg-transparent text-center text-[11px]"
    />
  </td>
);

interface NumberCellProps {
  label: string;
  value: number | null;
  optional?: boolean;
  onChange: (value: number | null) => void;
  onCommit: () => Promise<void>;
}

const NumberCell = ({ label, value, optional, onChange, onCommit }: NumberCellProps) => (
  <td className="p-0.5">
    <SettingsNumberField
      value={value}
      onValueChange={(next) => {
        if (next !== null || optional) onChange(next);
      }}
      onValueCommitted={onCommit}
      ariaLabel={label}
      className="h-6 bg-transparent"
    />
  </td>
);

const ElidableCell = ({ label, draft }: { label: AxisLabel; draft: AxisDraft }) => (
  <td>
    <div className="flex justify-center">
      <Checkbox
        checked={label.elidable}
        onCheckedChange={async (elidable) => {
          await draft.updateAndCommit((axis) =>
            replaceLabel(axis, label.id, (item) => ({ ...item, elidable })),
          );
        }}
        aria-label={`${label.name} elidable`}
      />
    </div>
  </td>
);

const RemoveCell = ({ label, draft }: { label: AxisLabel; draft: AxisDraft }) => (
  <td>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="mx-auto h-5 w-5 text-muted"
      aria-label={`Remove ${label.name}`}
      onClick={async () => {
        await draft.updateAndCommit((axis) => ({
          ...axis,
          labels: axis.labels.filter((item) => item.id !== label.id),
        }));
      }}
    >
      <MinusIcon className="h-2.5 w-2.5" />
    </Button>
  </td>
);

function isRangeLabel(label: AxisLabel): boolean {
  return label.minimum !== undefined || label.maximum !== undefined;
}

function updateLabelDraft(
  draft: AxisDraft,
  labelId: AxisLabelId,
  transform: (label: AxisLabel) => AxisLabel,
): void {
  draft.update((axis) => replaceLabel(axis, labelId, transform));
}

function replaceLabel(
  axis: Axis,
  labelId: AxisLabelId,
  transform: (label: AxisLabel) => AxisLabel,
): Axis {
  return {
    ...axis,
    labels: axis.labels.map((label) => (label.id === labelId ? transform(label) : label)),
  };
}

async function addLabel(draft: AxisDraft, range: boolean): Promise<void> {
  await draft.updateAndCommit((axis) => {
    const label: AxisLabel = {
      id: mintAxisLabelId(),
      name: "New style",
      value: axis.default,
      minimum: range ? axis.default : undefined,
      maximum: range ? axis.default : undefined,
      elidable: false,
    };
    return { ...axis, labels: [...axis.labels, label] };
  });
}
