import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { Axis } from "@shift/editor/model";
import type { AxisId, ConditionRange } from "@shift/types";
import {
  cn,
  Input,
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
  Tooltip,
  X,
} from "@shift/ui";
import { SidebarActionButton } from "@/components/sidebar";
import { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import {
  boundsDisplayText,
  boundsOfText,
  boundsOnAxis,
  roundedValue,
  type ConditionChipSpace,
} from "@/lib/variation/ConditionChipSpace";
import type { ChipAxisGroup, ChipBounds, ConditionChip } from "@/types/conditions";
import PlusIcon from "@/assets/general/plus.svg";

/** A chip whose equation popover is open: an existing one (`index`) or a new one (`index` null). */
interface ChipEdit {
  readonly index: number | null;
  readonly axis: Axis;
  readonly bounds: ChipBounds;
  readonly problem: string | null;
}

export interface ConditionChipsProps {
  /** Names the row for assistive technology, such as "dollar.bled condition". */
  label: string;
  chips: readonly ConditionChip[];
  /** The axes the + and the equation's axis menu offer, and how bounds are prefilled and read. */
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
 * A condition as a row of chips, `wght ≥ 694`, each with × on hover, and a
 * + after them: one shared editor for alternates and component conditions.
 *
 * @remarks
 * Clicking a chip opens its equation beside the sidebar, `[min] ≤ wght ≤
 * [max]`: an empty field leaves that side open. Typing or pasting `400-600`,
 * `>=700`, `700+` or `<=80` into either field fills both, as the engine reads
 * it. Enter, or clicking away, commits as one undo step; Escape reverts. A
 * minimum above the maximum stays, with the reason, and nothing is
 * committed. The axis button moves the condition to another axis, keeping
 * the bounds inside its range. + picks an axis and opens a new chip's
 * equation from where the canvas draws.
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
  const [edit, setEdit] = useState<ChipEdit | null>(() => {
    const [axis] = startNew ? (space.axisGroups[0]?.axes ?? []) : [];
    if (!axis) return null;
    return { index: null, axis, bounds: space.prefillBounds(axis), problem: null };
  });

  const startChip = (axis: Axis) =>
    setEdit({ index: null, axis, bounds: space.prefillBounds(axis), problem: null });
  const openChip = (index: number, chip: ConditionChip) =>
    setEdit({ index, axis: chip.axis, bounds: boundsOfText(chip.valueText), problem: null });

  const cancel = () => {
    const wasNew = edit !== null && edit.index === null;
    setEdit(null);
    if (wasNew && onNewCancelled) onNewCancelled();
  };

  const commit = async () => {
    if (!edit) return;

    const reading = space.rangeOf(edit.axis, edit.bounds);
    if (reading.kind === "problem") {
      setEdit({ ...edit, problem: reading.message });
      return;
    }

    try {
      await onCommit(edit.index, reading.range);
      setEdit(null);
    } catch (error) {
      setEdit({ ...edit, problem: error instanceof Error ? error.message : String(error) });
    }
  };

  // Closing by Escape reverts; any other close (a click away) commits.
  const onOpenChange = (open: boolean, reason: string) => {
    if (open) return;
    if (reason === "escape-key") cancel();
    else void commit();
  };

  const equation = edit && (
    <ConditionEquation
      edit={edit}
      groups={space.axisGroups}
      used={chips.flatMap((chip, index) => (index === edit.index ? [] : [chip.axis.id]))}
      onBounds={(side, text) => {
        const reading = space.boundsFromField(edit.axis, edit.bounds, side, text);
        if (reading.kind === "problem") {
          setEdit({ ...edit, bounds: { ...edit.bounds, [side]: text }, problem: reading.message });
          return;
        }
        setEdit({ ...edit, bounds: reading.bounds, problem: null });
      }}
      onAxis={(axis) =>
        setEdit({ ...edit, axis, bounds: boundsOnAxis(edit.bounds, axis), problem: null })
      }
      onCommit={() => void commit()}
    />
  );

  const views = chips.map((chip, index) => (
    <ChipView
      key={`${chip.axis.id}-${index}`}
      tag={chip.axis.tag}
      name={chip.axis.name}
      valueText={chip.displayText}
      disabled={disabled}
      open={edit?.index === index}
      onOpen={() => openChip(index, chip)}
      onOpenChange={onOpenChange}
      onRemove={() => void onRemove(index)}
      equation={edit?.index === index ? equation : null}
    />
  ));
  if (edit && edit.index === null) {
    views.push(
      <ChipView
        key="new"
        tag={edit.axis.tag}
        name={edit.axis.name}
        valueText={boundsDisplayText(edit.bounds)}
        disabled={disabled}
        open
        onOpen={() => undefined}
        onOpenChange={onOpenChange}
        equation={equation}
      />,
    );
  }
  const leading = views.slice(0, -1);
  const last = views.at(-1);

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {leading}
      {/* The last chip and what follows it stay on one line: the + never wraps alone. */}
      <span className="inline-flex shrink-0 items-center gap-1">
        {last}
        {note && <span className="px-0.5 text-ui text-muted">{note}</span>}
        {!disabled && edit === null && <AddChipButton space={space} onAxis={startChip} />}
      </span>
    </div>
  );
};

/**
 * One chip, `wght ≥ 694` (its axis by tag, the name in its tooltip and
 * label), with × on hover, and the equation popover it opens beside the
 * sidebar. While the popover is open the chip shows a focus ring.
 */
const ChipView = ({
  tag,
  name,
  valueText,
  disabled,
  open,
  onOpen,
  onOpenChange,
  onRemove,
  equation,
}: {
  tag: string;
  name: string;
  valueText: string;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  onOpenChange: (open: boolean, reason: string) => void;
  onRemove?: () => void;
  equation: ReactNode;
}) => {
  const panelAnchor = useSidebarPanelAnchor();
  const description = `${name} ${valueText}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) onOpen();
        else onOpenChange(false, details.reason);
      }}
      modal={false}
    >
      <span
        className={cn(
          "group/chip inline-flex h-5 items-center gap-1 rounded bg-input pl-1.5 pr-0.5 text-ui text-primary",
          open && "ring-1 ring-accent",
        )}
      >
        <Tooltip content={description}>
          <PopoverTrigger
            ref={panelAnchor.triggerRef}
            disabled={disabled}
            aria-label={`Edit ${description}`}
            render={
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
            }
          >
            {/* As the axis menus set a tag. */}
            <span className="font-mono text-secondary">{tag}</span>
            <span>{valueText}</span>
          </PopoverTrigger>
        </Tooltip>
        {!disabled && onRemove && (
          <Tooltip content="Remove">
            <button
              type="button"
              aria-label={`Remove ${description}`}
              onClick={onRemove}
              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted opacity-0 hover:bg-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover/chip:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </span>
      <PopoverPortal>
        <PopoverPositioner {...panelAnchor.positioner}>
          <PopoverPopup>
            <div className="p-2">{equation}</div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

/**
 * The equation a chip's popover edits, `[min] ≤ wght ≤ [max]`, and why it
 * can't be committed, if it can't.
 */
const ConditionEquation = ({
  edit,
  groups,
  used,
  onBounds,
  onAxis,
  onCommit,
}: {
  edit: ChipEdit;
  groups: readonly ChipAxisGroup[];
  /** Axes another chip of the condition is on: the axis menu disables them. */
  used: readonly AxisId[];
  onBounds: (side: keyof ChipBounds, text: string) => void;
  onAxis: (axis: Axis) => void;
  onCommit: () => void;
}) => {
  const { axis, bounds, problem } = edit;
  const field = (side: keyof ChipBounds, end: number, ariaLabel: string) => (
    <BoundField
      key={side}
      ariaLabel={ariaLabel}
      text={bounds[side]}
      placeholder={String(end)}
      invalid={problem !== null}
      onText={(text) => onBounds(side, text)}
      onCommit={onCommit}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-ui text-muted">
        {field("min", axis.minimum, `${axis.name} from`)}
        <span aria-hidden className="text-body">
          ≤
        </span>
        <AxisButton axis={axis} groups={groups} used={used} onAxis={onAxis} />
        <span aria-hidden className="text-body">
          ≤
        </span>
        {field("max", axis.maximum, `${axis.name} up to`)}
      </div>
      {problem && (
        <p role="alert" className="max-w-48 text-ui text-error">
          {problem}
        </p>
      )}
    </div>
  );
};

/**
 * One end of the equation: rounded while it isn't being typed in, exact
 * while it is; empty shows the axis's end, greyed. Enter commits.
 */
const BoundField = ({
  ariaLabel,
  text,
  placeholder,
  invalid,
  onText,
  onCommit,
}: {
  ariaLabel: string;
  text: string;
  placeholder: string;
  invalid: boolean;
  onText: (text: string) => void;
  onCommit: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  const number = Number(text);
  const shown =
    !focused && text.trim() !== "" && Number.isFinite(number) ? roundedValue(number) : text;

  return (
    <Input
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      className="w-14 text-right"
      value={shown}
      placeholder={placeholder}
      onFocus={(event) => {
        setFocused(true);
        event.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(event) => onText(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onCommit();
      }}
    />
  );
};

/** The equation's axis, `wght`, a button: a menu of the axes the condition may move to. */
const AxisButton = ({
  axis,
  groups,
  used,
  onAxis,
}: {
  axis: Axis;
  groups: readonly ChipAxisGroup[];
  used: readonly AxisId[];
  onAxis: (axis: Axis) => void;
}) => (
  <Menu modal={false}>
    <Tooltip content={`${axis.name}: choose another axis`}>
      <MenuTrigger
        aria-label={`Axis, ${axis.name}`}
        render={
          // Tab goes from the minimum straight to the maximum.
          <button
            type="button"
            tabIndex={-1}
            className="inline-flex h-6 items-center gap-0.5 rounded px-1 text-primary hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        }
      >
        <span className="font-mono">{axis.tag}</span>
      </MenuTrigger>
    </Tooltip>
    <MenuPortal>
      <MenuPositioner side="bottom" sideOffset={4} align="start">
        <MenuPopup>
          <AxisMenuItems groups={groups} used={used} onAxis={onAxis} />
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
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
            <AxisMenuItems groups={groups} used={[]} onAxis={onAxis} />
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};

/** The axes, under "Font axes" / "Glyph axes" headings once there are both. */
const AxisMenuItems = ({
  groups,
  used,
  onAxis,
}: {
  groups: readonly ChipAxisGroup[];
  used: readonly AxisId[];
  onAxis: (axis: Axis) => void;
}) => {
  if (groups.length === 1) {
    return <AxisItems axes={groups[0]!.axes} used={used} onAxis={onAxis} />;
  }

  return groups.map((group) => (
    <MenuGroup key={group.label}>
      <MenuGroupLabel>{group.label}</MenuGroupLabel>
      <AxisItems axes={group.axes} used={used} onAxis={onAxis} />
    </MenuGroup>
  ));
};

/** One menu item per axis, as Font axes' + menu lists them: the name, then the tag in mono. */
const AxisItems = ({
  axes,
  used,
  onAxis,
}: {
  axes: readonly Axis[];
  used: readonly AxisId[];
  onAxis: (axis: Axis) => void;
}) =>
  axes.map((axis) => (
    <MenuItem
      key={axis.id}
      disabled={used.includes(axis.id)}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-6"
      onClick={() => onAxis(axis)}
    >
      <span className="truncate">{axis.name}</span>
      <span className="font-mono text-secondary">{axis.tag}</span>
    </MenuItem>
  ));
