import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import FileIcon from "@assets/export/file.svg";
import FolderIcon from "@assets/export/folder.svg";
import { useExport } from "@/context/ExportContext";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { useAxes } from "@/hooks/useAxes";
import { useExportPlan, type ExportPlan } from "@/hooks/useExportPlan";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { folderBreadcrumb, middleCut, pathName } from "@/lib/export/exportPaths";
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
        <PopoverPositioner anchor={anchor} side="left" align="start" sideOffset={8}>
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

/** The files the row writes, as Rust names them, nested under the folder they go into. */
const PlannedFiles = ({ plan }: { plan: ExportPlan }) => {
  switch (plan.status) {
    // Names come back within a moment; the list fills in rather than showing a placeholder.
    case "planning":
      return null;
    case "failed":
      return <p className="text-ui text-secondary">{plan.reason}</p>;
    case "ready":
      // Eight rows, then the list scrolls.
      return (
        <ul
          aria-label={message("export.files")}
          className="scrollbar-hidden -mt-2 flex max-h-40 flex-col overflow-y-auto"
        >
          {plan.files.map((file, index) => (
            <FileRow key={file} path={file} last={index === plan.files.length - 1} />
          ))}
        </ul>
      );
  }
};

/** One file, joined to the folder above by a tree line: `├` for every row but the last, `└` for it. */
export const FileRow = ({ path, last }: { path: string; last: boolean }) => (
  <li className="flex h-5 shrink-0 items-center gap-1 pr-2 pl-3.5" title={path}>
    <svg aria-hidden width="10" height="20" viewBox="0 0 10 20" className="shrink-0 text-chrome">
      <path d={last ? "M1 0v10h9" : "M1 0v20M1 10h9"} fill="none" stroke="currentColor" />
    </svg>
    <span aria-hidden className="flex shrink-0 text-secondary">
      <FileIcon className="h-3.5 w-3.5" />
    </span>
    <MiddleCutName name={pathName(path)} />
  </li>
);

/**
 * A file name that keeps its end when it doesn't fit, as in
 * `Mutator…-LightCondensed.ttf`, so the instance it names stays readable.
 */
const MiddleCutName = ({ name }: { name: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);
  useLayoutEffect(() => {
    const element = ref.current;
    const context = measuringContext();
    if (!element || !context) return;
    context.font = getComputedStyle(element).font;
    const width = element.clientWidth;
    setShown(middleCut(name, (text) => context.measureText(text).width <= width));
  }, [name]);

  return (
    <span ref={ref} className="min-w-0 flex-1 truncate text-ui text-muted">
      {shown}
    </span>
  );
};

let measuring: CanvasRenderingContext2D | null | undefined;

/** A canvas context for measuring text, shared by every row; null where canvas is missing. */
function measuringContext(): CanvasRenderingContext2D | null {
  measuring ??= document.createElement("canvas").getContext("2d");
  return measuring;
}
