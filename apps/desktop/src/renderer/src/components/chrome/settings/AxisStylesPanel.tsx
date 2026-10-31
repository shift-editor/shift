import type { ReactNode } from "react";
import { Axis } from "@shift/editor/model";
import type { AxisLabel } from "@shift/types";
import type { AxisLabelKind } from "@shift/editor/types";
import { ascending } from "@shift/types";
import { Button, Checkbox, Input, Tooltip } from "@shift/ui";
import MinusIcon from "@/assets/general/minus.svg";
import PlusIcon from "@/assets/general/plus.svg";
import { SettingsNumberField } from "./SettingsNumberField";
import type { AxisDraft } from "./types";

interface AxisStylesPanelProps {
  draft: AxisDraft;
}

export const AxisStylesPanel = ({ draft }: AxisStylesPanelProps) => {
  const valueLabels = draft.axis.labels.filter((label) => !isRangeLabel(label));
  const rangeLabels = draft.axis.labels.filter(isRangeLabel);
  const labelsDisabled = draft.axis.role === "internal";
  const canAddLabel = nextLabelValue(draft.axis) !== null;

  return (
    <section className="flex flex-col gap-5 p-5 pr-8">
      <div>
        <h3 className="text-sm font-medium text-primary">Axes Styles</h3>
        {labelsDisabled && (
          <p className="mt-1 text-xs text-secondary">Internal axes cannot own external labels.</p>
        )}
        {draft.error && <p className="mt-1 text-xs text-error">{draft.error}</p>}
      </div>

      <StyleSection
        title="Value"
        onAdd={async () => {
          await addLabel(draft, "value");
        }}
        disabled={labelsDisabled || !canAddLabel}
      >
        <ValueLabelsTable labels={valueLabels} draft={draft} />
      </StyleSection>

      <StyleSection
        title="Range"
        onAdd={async () => {
          await addLabel(draft, "range");
        }}
        disabled={labelsDisabled || !canAddLabel}
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
    <h4 className="text-sm text-primary">{title}</h4>
    {children}
    <Button
      type="button"
      variant="primary"
      size="sm"
      className="self-start text-sm"
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
        <tr key={label.id} className="group">
          <NameCell label={label} draft={draft} />
          <NumberCell
            label={`${label.name} value`}
            value={labelValue}
            onChange={(value) => {
              if (value !== null) {
                draft.update((current) => new Axis(current).withLabelValue(label.id, value));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} linked value`}
            value={label.linkedValue ?? null}
            optional
            onChange={(linkedValue) =>
              draft.update((current) =>
                new Axis(current).withLabelLinkedValue(label.id, linkedValue),
              )
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
        <tr key={label.id} className="group">
          <NameCell label={label} draft={draft} />
          <NumberCell
            label={`${label.name} default`}
            value={labelValue}
            onChange={(value) => {
              if (value !== null) {
                draft.update((current) => new Axis(current).withLabelValue(label.id, value));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} minimum`}
            value={label.range?.minimum ?? labelValue}
            onChange={(minimum) => {
              if (minimum !== null) {
                draft.update((current) => new Axis(current).withLabelRange(label.id, { minimum }));
              }
            }}
            onCommit={draft.commit}
          />
          <NumberCell
            label={`${label.name} maximum`}
            value={label.range?.maximum ?? labelValue}
            onChange={(maximum) => {
              if (maximum !== null) {
                draft.update((current) => new Axis(current).withLabelRange(label.id, { maximum }));
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
  <div className="overflow-hidden rounded border border-line-subtle bg-surface">
    <table className="w-full table-fixed border-collapse text-center text-sm">
      <thead className="bg-input text-primary">
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
        draft.update((current) => new Axis(current).withLabelName(label.id, name));
      }}
      onBlur={async () => {
        await draft.commit();
      }}
      variant="plain"
      className="text-center text-sm"
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
      inputClassName="text-center"
    />
  </td>
);

const ElidableCell = ({ label, draft }: { label: AxisLabel; draft: AxisDraft }) => (
  <td>
    <div className="flex justify-center">
      <Checkbox
        checked={label.elidable}
        onCheckedChange={async (elidable) => {
          await draft.updateAndCommit((current) =>
            new Axis(current).withLabelElidable(label.id, elidable),
          );
        }}
        aria-label={`${label.name} elidable`}
      />
    </div>
  </td>
);

const RemoveCell = ({ label, draft }: { label: AxisLabel; draft: AxisDraft }) => (
  <td>
    <Tooltip content={`Remove ${label.name}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mx-auto h-5 w-5 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-icon-button-hover"
        aria-label={`Remove ${label.name}`}
        onClick={async () => {
          await draft.updateAndCommit((current) => new Axis(current).withoutLabel(label.id));
        }}
      >
        <MinusIcon className="h-2.5 w-2.5" />
      </Button>
    </Tooltip>
  </td>
);

function isRangeLabel(label: AxisLabel): boolean {
  return label.range != null;
}

async function addLabel(draft: AxisDraft, kind: AxisLabelKind): Promise<void> {
  await draft.updateAndCommit((current) => {
    const axis = new Axis(current);
    const value = nextLabelValue(axis);
    if (value === null) return current;

    return axis.withNewLabel(value, kind);
  });
}

function nextLabelValue(axis: Axis): number | null {
  const used = new Set(axis.labels.map(({ value }) => value));
  if (!used.has(axis.default)) return axis.default;

  if (axis.isDiscrete) {
    return axis.values.find((value) => !used.has(value)) ?? null;
  }

  const { minimum, maximum } = axis;
  if (!used.has(minimum)) return minimum;
  if (!used.has(maximum)) return maximum;

  const values = [...used].filter((value) => axis.accepts(value)).sort(ascending);
  let largestGap = 0;
  let available: number | null = null;

  for (let index = 1; index < values.length; index += 1) {
    const left = values[index - 1];
    const right = values[index];
    const gap = right - left;
    const midpoint = left + gap / 2;
    if (gap <= largestGap || midpoint === left || midpoint === right || used.has(midpoint))
      continue;

    largestGap = gap;
    available = midpoint;
  }

  return available;
}
