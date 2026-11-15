import { useState } from "react";
import {
  Button,
  Check,
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
import { ExportPopover } from "./ExportPopover";
import { ExportRowOptions } from "./ExportRowOptions";
import { outputLabel, targetLabel } from "./exportLabels";

const TARGET_ICON = {
  variable: VariableIcon,
  static: StaticIcon,
  ufo: UfoIcon,
} as const satisfies Record<ExportTarget, React.ComponentType<React.SVGProps<SVGSVGElement>>>;

/**
 * The left sidebar's Export section, after the font's sources and instances
 * in Home and the editor's Designspace tab: one row per output, then the
 * Export button, which writes every row.
 *
 * @remarks
 * A preview of a UFO or Glyphs file shows only Save as .shift, since only a
 * .shift document can be exported. A preview
 * of a compiled font has nothing to export, so it shows no section.
 */
export const ExportSection = () => {
  const exports = useExport();
  const session = useFontSession();
  const canAuthor = session.mode === "workspace";
  const [section, setSection] = useState<HTMLElement | null>(null);
  if (session.mode === "preview" && !session.canConvert) return null;

  return (
    <section ref={setSection} aria-label={message("export.title")}>
      <CollapsibleSection
        title={message("export.title")}
        open={exports.open}
        onOpenChange={exports.setOpen}
        actions={
          canAuthor ? (
            <Tooltip content={message("export.addRow")}>
              <SidebarActionButton label={message("export.addRow")} onClick={exports.addRow}>
                <PlusIcon className="h-3 w-3" />
              </SidebarActionButton>
            </Tooltip>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2 px-2 pb-2">
          {/* A preview's rows could not run, so it shows only Save as .shift. */}
          {canAuthor ? (
            <ul aria-label={message("export.rows")} className="flex flex-col gap-1">
              {exports.rows.map((row) => (
                <ExportRowLine
                  key={row.id}
                  row={row}
                  status={rowStatus(exports.run, row.id)}
                  panelAnchor={section}
                />
              ))}
            </ul>
          ) : null}
          <ExportFooter anchor={section} />
        </div>
      </CollapsibleSection>
    </section>
  );
};

/** Why row `id` didn't export in `run`, or null. */
function failureReason(run: ExportRun, id: string): string | null {
  const outcome = run.status === "idle" ? undefined : run.outcomes[id];
  return outcome !== undefined && "reason" in outcome ? outcome.reason : null;
}

function rowStatus(run: ExportRun, id: string): ExportRowStatus | null {
  return run.status === "idle" ? null : (run.rows[id] ?? null);
}

const ExportRowLine = ({
  row,
  status,
  panelAnchor,
}: {
  row: ExportRow;
  status: ExportRowStatus | null;
  /** The section, so a row's options open beside the sidebar rather than over it. */
  panelAnchor: HTMLElement | null;
}) => {
  const exports = useExport();
  const running = exports.run.status === "exporting";
  const locked = running;
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
      <ExportRowOptions row={row} anchor={panelAnchor} />
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
        <Tooltip content={failureReason(exports.run, row.id)}>
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

/** The Export button, which opens the Export popover, or Save as .shift for a preview. */
const ExportFooter = ({ anchor }: { anchor: HTMLElement | null }) => {
  const session = useFontSession();
  const host = getShiftHost();
  const isMac = host.platform === "darwin";

  if (session.mode !== "workspace") {
    // Save converts a preview to .shift, so Save as .shift shows Save's shortcut.
    const saveShortcut = commandShortcutLabel(commandShortcuts["file.save"], isMac);
    return (
      <Button
        variant="outline"
        size="compact"
        className="w-full"
        onClick={() => {
          void host.commands.run("file.save").catch((error: unknown) => {
            console.error("preview conversion failed", error);
          });
        }}
      >
        <span className="flex items-center gap-2">
          {message("export.saveAsShift")}
          <kbd className="font-ui text-ui text-secondary">{saveShortcut}</kbd>
        </span>
      </Button>
    );
  }

  return (
    <ExportPopover
      workspace={session.workspace}
      shortcut={commandShortcutLabel(commandShortcuts["file.export"], isMac)}
      anchor={anchor}
    />
  );
};
