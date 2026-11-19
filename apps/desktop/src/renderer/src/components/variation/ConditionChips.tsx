import { useState, type KeyboardEvent } from "react";
import type { Axis } from "@shift/editor/model";
import type { ConditionRange } from "@shift/types";
import {
  Input,
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Tooltip,
  X,
} from "@shift/ui";
import { SidebarActionButton } from "@/components/sidebar";
import type { ConditionChipSpace } from "@/lib/variation/ConditionChipSpace";
import type { ConditionChip } from "@/types/conditions";
import PlusIcon from "@/assets/general/plus.svg";

/** A chip being typed: an existing one (`index`) or a new one (`index` null). */
interface ChipDraft {
  readonly index: number | null;
  readonly axis: Axis;
  readonly text: string;
  readonly problem: string | null;
}

export interface ConditionChipsProps {
  /** Names the row for assistive technology, such as "dollar.bled condition". */
  label: string;
  chips: readonly ConditionChip[];
  /** The axes the + offers, and how a chip's text is prefilled and read. */
  space: ConditionChipSpace;
  /** Commits a chip's range: in place of the chip at `index`, or a new one when null. */
  onCommit: (index: number | null, range: ConditionRange) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
  /** Starts a new chip at once, as adding an alternate does. */
  startNew?: boolean;
  /** A new chip was cancelled with Escape: the caller drops what it began. */
  onNewCancelled?: () => void;
  /** Shown after the chips, such as "Mixed" for components that differ. */
  note?: string;
  disabled?: boolean;
}

/**
 * A condition as a row of chips, `Weight ≥ 700`, each with ×, and a + after
 * them: one shared editor for alternates and component conditions.
 *
 * @remarks
 * + picks an axis (from a menu when there are several) and starts a chip
 * prefilled from where the canvas draws, `≥ 700`, its value selected. A
 * chip's text reads `700`, `>=700`, `≥700`, `700+`, `<=80`, `≤80`,
 * `400-600` or `400–600`, as the engine parses it. Enter commits; Escape
 * cancels, and removes a new chip; text that can't be read stays, with the
 * reason under the row. Clicking a chip edits its value in place.
 */
export const ConditionChips = ({
  label,
  chips,
  space,
  onCommit,
  onRemove,
  startNew = false,
  onNewCancelled,
  note,
  disabled = false,
}: ConditionChipsProps) => {
  const [draft, setDraft] = useState<ChipDraft | null>(() => {
    const [axis] = startNew ? (space.axisGroups[0]?.axes ?? []) : [];
    if (!axis) return null;
    return { index: null, axis, text: space.prefill(axis), problem: null };
  });

  const startChip = (axis: Axis) =>
    setDraft({ index: null, axis, text: space.prefill(axis), problem: null });
  const editChip = (index: number, chip: ConditionChip) =>
    setDraft({ index, axis: chip.axis, text: chip.valueText, problem: null });

  const cancel = () => {
    const wasNew = draft !== null && draft.index === null;
    setDraft(null);
    if (wasNew && onNewCancelled) onNewCancelled();
  };

  const commit = async () => {
    if (!draft) return;

    const reading = space.read(draft.axis, draft.text);
    if (reading.kind === "problem") {
      setDraft({ ...draft, problem: reading.message });
      return;
    }

    try {
      await onCommit(draft.index, reading.range);
      setDraft(null);
    } catch (error) {
      setDraft({ ...draft, problem: error instanceof Error ? error.message : String(error) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        void commit();
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
    }
  };

  const editingIndex = draft === null ? undefined : draft.index;
  const problem = draft === null ? null : draft.problem;
  const draftField = draft && (
    <ChipFrame key="draft">
      <span className="text-muted">{draft.axis.name}</span>
      <Input
        aria-label={`${draft.axis.name} condition`}
        aria-invalid={draft.problem ? true : undefined}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        value={draft.text}
        onChange={(event) => setDraft({ ...draft, text: event.target.value, problem: null })}
        onKeyDown={onKeyDown}
        className="h-4 rounded-sm px-0.5 text-ui"
        style={{ width: `${Math.max(draft.text.length, 3) + 1}ch` }}
      />
    </ChipFrame>
  );

  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
        {chips.map((chip, index) =>
          editingIndex === index ? (
            draftField
          ) : (
            <ChipView
              key={`${chip.axis.id}-${index}`}
              chip={chip}
              disabled={disabled}
              onEdit={() => editChip(index, chip)}
              onRemove={() => void onRemove(index)}
            />
          ),
        )}
        {editingIndex === null && draftField}
        {note && <span className="px-0.5 text-ui text-muted">{note}</span>}
        {!disabled && draft === null && <AddChipButton space={space} onAxis={startChip} />}
      </div>
      {problem && (
        <p role="alert" className="text-ui text-error">
          {problem}
        </p>
      )}
    </div>
  );
};

const ChipFrame = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex h-5 items-center gap-1 rounded bg-input pl-1.5 pr-0.5 text-ui text-primary">
    {children}
  </span>
);

/** A committed chip: its axis muted, its value plain, and ×. */
const ChipView = ({
  chip,
  disabled,
  onEdit,
  onRemove,
}: {
  chip: ConditionChip;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) => (
  <ChipFrame>
    <button
      type="button"
      disabled={disabled}
      aria-label={`Edit ${chip.axis.name} ${chip.valueText}`}
      onClick={onEdit}
      className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="text-muted">{chip.axis.name}</span>
      <span>{chip.valueText}</span>
    </button>
    {!disabled && (
      <Tooltip content="Remove">
        <button
          type="button"
          aria-label={`Remove ${chip.axis.name} ${chip.valueText}`}
          onClick={onRemove}
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <X className="h-3 w-3" />
        </button>
      </Tooltip>
    )}
  </ChipFrame>
);

/** The + after the chips: one axis starts a chip on it, several open a menu of them beside the sidebar. */
const AddChipButton = ({
  space,
  onAxis,
}: {
  space: ConditionChipSpace;
  onAxis: (axis: Axis) => void;
}) => {
  const groups = space.axisGroups;
  const axes = groups.flatMap((group) => group.axes);
  const [only] = axes;
  if (!only) return null;

  if (axes.length === 1) {
    return (
      <Tooltip content="Add a condition">
        <SidebarActionButton label="Add a condition" onClick={() => onAxis(only)}>
          <PlusIcon className="h-3 w-3" />
        </SidebarActionButton>
      </Tooltip>
    );
  }

  return (
    <Menu modal={false}>
      <Tooltip content="Add a condition">
        <MenuTrigger
          render={
            <SidebarActionButton label="Add a condition">
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          }
        />
      </Tooltip>
      <MenuPortal>
        <MenuPositioner side="right" sideOffset={4} align="start">
          <MenuPopup>
            {groups.length === 1 ? (
              <AxisItems axes={axes} onAxis={onAxis} />
            ) : (
              groups.map((group) => (
                <MenuGroup key={group.label}>
                  <MenuGroupLabel>{group.label}</MenuGroupLabel>
                  <AxisItems axes={group.axes} onAxis={onAxis} />
                </MenuGroup>
              ))
            )}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};

/** One menu item per axis. */
const AxisItems = ({ axes, onAxis }: { axes: readonly Axis[]; onAxis: (axis: Axis) => void }) =>
  axes.map((axis) => (
    <MenuItem key={axis.id} onClick={() => onAxis(axis)}>
      {axis.name}
    </MenuItem>
  ));
