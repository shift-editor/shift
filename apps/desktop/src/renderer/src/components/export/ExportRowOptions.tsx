import { useMemo, useState } from "react";
import {
  Button,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  X,
} from "@shift/ui";
import { message } from "@shared/messages";
import OptionsIcon from "@assets/export/options.svg";
import FolderIcon from "@assets/export/folder.svg";
import { useExport } from "@/context/ExportContext";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { useAxes } from "@/hooks/useAxes";
import { useExportPlan, type ExportPlan } from "@/hooks/useExportPlan";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { folderBreadcrumb, pathName } from "@/lib/export/exportPaths";
import { exportRequestFor, type ExportRow } from "@/types/export";
import type { Workspace } from "@/workspace/Workspace";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { outputLabel, targetLabel } from "./exportLabels";

/**
 * A row's options button and the panel it opens beside the sidebar: the
 * folder the row writes into, and the files it writes there.
 */
export const ExportRowOptions = ({
  row,
  anchor,
}: {
  row: ExportRow;
  /** What the panel lines up with: the Export section, so it opens beside the sidebar. */
  anchor: HTMLElement | null;
}) => {
  const [open, setOpen] = useState(false);
  const label = `${targetLabel(row.target)} · ${outputLabel(row.output)}`;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content={message("export.options")}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              isActive={open}
              aria-label={message("export.options")}
              className="shrink-0 text-sidebar-icon"
            >
              <OptionsIcon aria-hidden className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </Tooltip>
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} side="right" align="start" sideOffset={8}>
          {open ? <OptionsPanel row={row} title={label} /> : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

const OptionsPanel = ({ row, title }: { row: ExportRow; title: string }) => {
  const session = useFontSession();

  return (
    <PopoverPopup className="flex w-60 flex-col p-0">
      <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
        <PopoverTitle>{title}</PopoverTitle>
        <Tooltip content={message("export.options.close")}>
          <PopoverClose variant="icon" aria-label={message("export.options.close")}>
            <X className="h-4 w-4" />
          </PopoverClose>
        </Tooltip>
      </div>
      {session.mode === "workspace" ? (
        <OptionsBody row={row} workspace={session.workspace} />
      ) : null}
    </PopoverPopup>
  );
};

const OptionsBody = ({ row, workspace }: { row: ExportRow; workspace: Workspace }) => {
  const exports = useExport();
  const folder = exports.folder(row.target);
  // One request per target and output: the plan re-runs whenever its encodings array changes.
  const { format, encodings } = useMemo(
    () => exportRequestFor({ target: row.target, output: row.output }),
    [row.target, row.output],
  );
  const plan = useExportPlan(workspace, format, encodings, folder);
  const needsInstances = useNeedsInstances(row);

  return (
    <div className="flex flex-col gap-3 p-2">
      {/* The folder is its own chooser: click it to pick another. */}
      <Tooltip content={folder ?? message("export.folder.choose")}>
        <Button
          variant="field"
          size="field"
          aria-label={message("export.folder.label")}
          onClick={() => void exports.chooseFolder(row.target)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="flex shrink-0 text-secondary">
              <FolderIcon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">
              {folder === null
                ? message("export.folder.none")
                : folderBreadcrumb(folder).join(" › ")}
            </span>
          </span>
        </Button>
      </Tooltip>
      {needsInstances ? <NoInstances /> : <PlannedFiles plan={plan} />}
    </div>
  );
};

/** Whether `row` exports static fonts from a variable font that has no named instances. */
function useNeedsInstances(row: ExportRow): boolean {
  const axes = useAxes();
  const instances = useNamedInstances();
  return row.target === "static" && axes.length > 0 && instances.length === 0;
}

const NoInstances = () => {
  const settings = useSettingsNavigation();
  return (
    <div className="flex flex-col items-start gap-2 text-ui text-secondary">
      {message("export.static.noInstances")}
      <Button
        variant="outline"
        size="compact"
        onClick={() => settings.open({ category: "instances" })}
      >
        {message("export.static.addInstances")}
      </Button>
    </div>
  );
};

/** The files the row writes, as Rust names them, under how many there are. */
const PlannedFiles = ({ plan }: { plan: ExportPlan }) => {
  switch (plan.status) {
    // Names come back within a moment; the list fills in rather than showing a placeholder.
    case "planning":
      return null;
    case "failed":
      return <p className="text-ui text-secondary">{plan.reason}</p>;
    case "ready": {
      const [only] = plan.files;
      // One file reads as a sentence; several list every name under their count.
      if (plan.files.length === 1 && only !== undefined) {
        return (
          <p className="truncate text-ui text-secondary" title={only}>
            {message("export.files.writes")} <span className="text-primary">{pathName(only)}</span>
          </p>
        );
      }
      return (
        <div className="flex flex-col gap-1">
          <span className="text-ui text-primary">{message("export.files.many", { count: plan.files.length })}</span>
          <ul className="scrollbar-hidden flex max-h-40 flex-col overflow-y-auto text-ui text-secondary">
            {plan.files.map((file) => (
              <li key={file} className="truncate leading-5" title={file}>
                {pathName(file)}
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
};
