import { useState } from "react";
import {
  Button,
  Check,
  Progress,
  Select,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  ChevronDown,
  Tooltip,
  cn,
} from "@shift/ui";
import { commandShortcuts } from "@shared/commands";
import { message } from "@shared/messages";
import MinusIcon from "@assets/general/minus.svg";
import PlusIcon from "@assets/general/plus.svg";
import StaticIcon from "@assets/export/target-static.svg";
import UfoIcon from "@assets/export/target-ufo.svg";
import VariableIcon from "@assets/export/target-variable.svg";
import WarningIcon from "@assets/general/warning.svg";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { useExport, type ExportRowStatus, type ExportRun } from "@/context/ExportContext";
import { getShiftHost } from "@/host/shiftHost";
import { commandShortcutLabel } from "@/lib/keyboard/commandShortcutLabel";
import {
  EXPORT_TARGETS,
  isOutputOf,
  outputsFor,
  type ExportRow,
  type ExportTarget,
} from "@/types/export";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { ExportRowOptions } from "./ExportRowOptions";
import { outputLabel, targetLabel } from "./exportLabels";

const TARGET_ICON = {
  variable: VariableIcon,
  static: StaticIcon,
  ufo: UfoIcon,
} as const satisfies Record<ExportTarget, React.ComponentType<React.SVGProps<SVGSVGElement>>>;

/**
 * The left sidebar's Export section, pinned below its lists in Home and the
 * editor: one row per output, then the Export button, which writes every row.
 *
 * @remarks
 * Collapsing hides the rows but keeps the button and a run's progress.
 * A read-only preview shows its rows with Save as .shift in place of Export,
 * since only a .shift document can be exported.
 */
export const ExportSection = () => {
  const exports = useExport();
  const canAuthor = useFontSession().mode === "workspace";
  const [section, setSection] = useState<HTMLElement | null>(null);

  return (
    <section
      ref={setSection}
      aria-label={message("export.title")}
      className="flex shrink-0 flex-col gap-2 border-t border-line-subtle px-1 pt-2 pb-3"
    >
      <CollapsibleSection
        title={message("export.title")}
        open={exports.open}
        onOpenChange={exports.setOpen}
        actions={
          <Tooltip content={message("export.addRow")}>
            <SidebarActionButton
              label={message("export.addRow")}
              aria-disabled={!canAuthor || undefined}
              onClick={() => {
                if (canAuthor) exports.addRow();
              }}
            >
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          </Tooltip>
        }
      >
        <ul aria-label={message("export.rows")} className="flex flex-col gap-1 px-2">
          {exports.rows.map((row) => (
            <ExportRowLine
              key={row.id}
              row={row}
              status={rowStatus(exports.run, row.id)}
              canAuthor={canAuthor}
              panelAnchor={section}
            />
          ))}
        </ul>
      </CollapsibleSection>
      <div className="px-2">
        <ExportFooter canAuthor={canAuthor} />
      </div>
    </section>
  );
};

function rowStatus(run: ExportRun, id: string): ExportRowStatus | null {
  return run.status === "idle" ? null : (run.rows[id] ?? null);
}

const ExportRowLine = ({
  row,
  status,
  canAuthor,
  panelAnchor,
}: {
  row: ExportRow;
  status: ExportRowStatus | null;
  canAuthor: boolean;
  /** The section, so a row's options open beside the sidebar rather than over it. */
  panelAnchor: HTMLElement | null;
}) => {
  const exports = useExport();
  const running = exports.run.status === "exporting";
  const locked = !canAuthor || running;
  const changeTarget = (target: ExportTarget) => {
    const output = isOutputOf(target, row.output) ? row.output : outputsFor[target][0];
    exports.updateRow(row.id, { target, output });
  };

  return (
    <li className="flex h-7 min-w-0 items-center gap-1">
      <RowSelect
        label={message("export.targetMenu")}
        value={row.target}
        options={EXPORT_TARGETS}
        disabled={locked}
        optionLabel={targetLabel}
        icon={TARGET_ICON[row.target]}
        grow="wide"
        onChange={changeTarget}
      />
      <RowSelect
        label={message("export.outputMenu")}
        value={row.output}
        options={outputsFor[row.target]}
        disabled={locked}
        optionLabel={outputLabel}
        grow="narrow"
        onChange={(output) => exports.updateRow(row.id, { target: row.target, output })}
      />
      <ExportRowOptions row={row} disabled={!canAuthor} anchor={panelAnchor} />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <RowEnd row={row} status={status} disabled={locked} />
      </span>
    </li>
  );
};

/** One of a row's two menus: what it exports, and in which format. */
function RowSelect<Value extends string>({
  label,
  value,
  options,
  disabled,
  optionLabel,
  icon: Icon,
  grow,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  disabled: boolean;
  optionLabel: (value: Value) => string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** The target menu takes three fifths of the row's fields, so "Variable" fits beside its icon. */
  grow: "wide" | "narrow";
  onChange: (value: Value) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger
        variant="field"
        aria-label={label}
        className={cn("min-w-0 basis-0", grow === "wide" ? "grow-3" : "grow-2")}
      >
        {Icon ? <Icon aria-hidden className="h-4 w-4 shrink-0 text-sidebar-icon" /> : null}
        <span className="min-w-0 flex-1 truncate text-left">{optionLabel(value)}</span>
        <span aria-hidden className="flex shrink-0 text-muted">
          <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
        </span>
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner sideOffset={4} align="start">
          <SelectPopup>
            <SelectList>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  <SelectItemIndicator />
                  <SelectItemText>{optionLabel(option)}</SelectItemText>
                </SelectItem>
              ))}
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

/** The end of a row: its remove button, or where it stands while a run shows. */
const RowEnd = ({
  row,
  status,
  disabled,
}: {
  row: ExportRow;
  status: ExportRowStatus | null;
  disabled: boolean;
}) => {
  const exports = useExport();
  switch (status) {
    case "waiting":
      return (
        <span
          role="img"
          aria-label={message("export.status.waiting")}
          className="h-1 w-1 rounded-full bg-control-muted"
        />
      );
    case "exporting":
      return (
        <span
          role="img"
          aria-label={message("export.status.exporting")}
          className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
      );
    case "done":
      return (
        <span role="img" aria-label={message("export.status.done")} className="flex text-state-on">
          <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      );
    case "failed":
      return (
        <Tooltip content={exports.run.status === "failed" ? exports.run.reason : null}>
          <WarningIcon
            role="img"
            aria-label={message("export.status.failed")}
            className="h-3.5 w-3.5 text-error"
          />
        </Tooltip>
      );
    case null:
      return (
        <Tooltip content={message("export.removeRow")}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={message("export.removeRow")}
            aria-disabled={disabled || undefined}
            className="text-sidebar-icon"
            onClick={() => {
              if (!disabled) exports.removeRow(row.id);
            }}
          >
            <MinusIcon aria-hidden className="h-3 w-3" />
          </Button>
        </Tooltip>
      );
  }
};

/** Export, a run's progress, its result, or Save as .shift for a preview. */
const ExportFooter = ({ canAuthor }: { canAuthor: boolean }) => {
  const exports = useExport();
  const { run, rows } = exports;
  const host = getShiftHost();
  const shortcut = commandShortcutLabel(
    commandShortcuts["file.export"],
    host.platform === "darwin",
  );

  if (!canAuthor) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          void host.commands.run("file.save").catch((error: unknown) => {
            console.error("preview conversion failed", error);
          });
        }}
      >
        {message("export.saveAsShift")}
      </Button>
    );
  }

  switch (run.status) {
    case "exporting":
      return <ExportProgress run={run} rows={rows} />;
    case "done":
      return (
        <div role="status">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void exports.reveal()}
          >
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="flex text-state-on">
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              {message("export.done")}
            </span>
          </Button>
        </div>
      );
    case "failed":
    case "idle":
      return (
        <div className="flex flex-col gap-2">
          {run.status === "failed" ? (
            <p role="alert" title={run.reason} className="text-ui text-error">
              {message("export.failed")}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            aria-disabled={rows.length === 0 || undefined}
            onClick={() => {
              if (rows.length > 0) void exports.exportAll();
            }}
          >
            <span className="flex items-center gap-2">
              {message("export.action")}
              <kbd className="font-sans text-ui text-secondary">{shortcut}</kbd>
            </span>
          </Button>
        </div>
      );
  }
};

/** Which row is being written, how many are done, Stop, and a bar that fills per row. */
const ExportProgress = ({
  run,
  rows,
}: {
  run: Extract<ExportRun, { status: "exporting" }>;
  rows: readonly ExportRow[];
}) => {
  const exports = useExport();
  const current = rows.find((row) => run.rows[row.id] === "exporting");
  const finished = rows.filter((row) => {
    const status = run.rows[row.id];
    return status === "done" || status === "failed";
  }).length;
  const position = Math.min(finished + 1, rows.length);
  const label = current
    ? `${targetLabel(current.target)} · ${outputLabel(current.output)}`
    : message("export.exporting");

  return (
    <div role="status" className="flex flex-col gap-2">
      <div className="flex h-4 min-w-0 items-center gap-2 text-ui">
        <span className="min-w-0 flex-1 truncate text-primary">
          {message("export.exportingRow", { row: label })}
        </span>
        <span className="shrink-0 text-secondary">
          {message("export.position", { position, total: rows.length })}
        </span>
        <button
          type="button"
          disabled={run.stopping}
          className={cn("shrink-0 text-secondary hover:text-primary", run.stopping && "opacity-50")}
          onClick={exports.stop}
        >
          {message("export.stop")}
        </button>
      </div>
      <Progress
        aria-label={message("export.progress")}
        value={(finished / rows.length) * 100}
        trackClassName="h-1"
      />
    </div>
  );
};
