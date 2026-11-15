import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Check,
  ChevronDown,
  ChevronRight,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  X,
  cn,
} from "@shift/ui";
import { message } from "@shared/messages";
import { useExport, type ExportRowStatus, type ExportRun } from "@/context/ExportContext";
import { useExportPlan } from "@/hooks/useExportPlan";
import { exportRequestFor, type ExportRow } from "@/types/export";
import type { Workspace } from "@/workspace/Workspace";
import { FileRow } from "./ExportRowOptions";
import { outputLabel, targetLabel } from "./exportLabels";

/**
 * The Export button and the popover it opens above it: what a run will write,
 * then the run row by row, then where each row went.
 *
 * @remarks
 * ⇧⌘E opens the same popover. Closing it during a run leaves the run going;
 * closing it after one forgets the results, so it opens on the next run.
 */
export const ExportPopover = ({
  workspace,
  shortcut,
  anchor,
}: {
  workspace: Workspace;
  /** Export's shortcut, shown after the button's label. */
  shortcut: string;
  /** What the popover's top lines up with: the Export section, so it opens beside the sidebar. */
  anchor: HTMLElement | null;
}) => {
  const exports = useExport();
  const { run, rows } = exports;

  return (
    <Popover
      open={exports.popoverOpen}
      onOpenChange={(open) => {
        exports.setPopoverOpen(open);
        if (!open) exports.dismiss();
      }}
      modal={false}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="compact"
            className="w-full"
            aria-disabled={rows.length === 0 || undefined}
          >
            <span className="flex items-center gap-2">
              {message("export.action")}
              <kbd className="font-ui text-ui text-secondary">{shortcut}</kbd>
            </span>
          </Button>
        }
      />
      <PopoverPortal>
        {/*
          Top-aligned and never shifted to fit: opening a row, or a run changing what the
          popover shows, moves only its bottom edge, so nothing under the pointer moves.
          It scrolls instead when it is taller than the room below its top.
        */}
        <PopoverPositioner
          anchor={anchor}
          side="right"
          align="start"
          sideOffset={8}
          collisionAvoidance={{ side: "none", align: "none" }}
        >
          <PopoverPopup className="flex max-h-(--available-height) w-70 flex-col overflow-y-auto p-0">
            {run.status === "idle" ? (
              <ConfirmExport workspace={workspace} rows={rows} />
            ) : (
              <RunRows run={run} rows={rows} />
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

/** The popover's title row, with a close button unless a run is going. */
const Header = ({ title, end }: { title: string; end?: ReactNode }) => (
  <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
    <PopoverTitle>{title}</PopoverTitle>
    {end ?? (
      <Tooltip content={message("export.options.close")}>
        <PopoverClose variant="icon" aria-label={message("export.options.close")}>
          <X className="h-4 w-4" />
        </PopoverClose>
      </Tooltip>
    )}
  </div>
);

/** Before a run: each row with how many files it writes, opening to their names. */
const ConfirmExport = ({
  workspace,
  rows,
}: {
  workspace: Workspace;
  rows: readonly ExportRow[];
}) => {
  const exports = useExport();
  const title =
    rows.length === 1
      ? message("export.confirm.titleOne")
      : message("export.confirm.title", { count: rows.length });

  return (
    <>
      <Header title={title} />
      <ul className="flex flex-col py-1">
        {rows.map((row) => (
          <PlannedRow key={row.id} workspace={workspace} row={row} />
        ))}
      </ul>
      <div className="flex items-center justify-end gap-1.5 border-t border-line-subtle p-2">
        <PopoverClose render={<Button variant="ghost" size="compact" />}>
          {message("export.cancel")}
        </PopoverClose>
        <Button autoFocus variant="outline" size="compact" onClick={() => void exports.exportAll()}>
          <span className="flex items-center gap-2">
            {message("export.action")}
            <kbd className="font-ui text-ui text-secondary">↵</kbd>
          </span>
        </Button>
      </div>
    </>
  );
};

/** One row before a run: its name and file count; it opens to the files it writes. */
const PlannedRow = ({ workspace, row }: { workspace: Workspace; row: ExportRow }) => {
  const exports = useExport();
  const [open, setOpen] = useState(false);
  const { format, encodings } = useMemo(
    () => exportRequestFor({ target: row.target, output: row.output }),
    [row.target, row.output],
  );
  const plan = useExportPlan(workspace, format, encodings, exports.folder(row.target));
  const files = plan.status === "ready" ? plan.files : [];
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-6 items-center gap-1.5 px-2 text-left text-ui hover:bg-hover/50"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden className="flex w-3 shrink-0 justify-center text-secondary">
          <Chevron className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-primary">{rowLabel(row)}</span>
        <span className="shrink-0 text-secondary">{fileCount(plan.status, files.length)}</span>
      </button>
      {open && files.length > 0 ? (
        <ul className="scrollbar-hidden flex max-h-40 flex-col overflow-y-auto pb-1">
          {files.map((file, index) => (
            <FileRow key={file} path={file} last={index === files.length - 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

/** During and after a run: each row's status, then Stop, or Show in Finder and Retry. */
const RunRows = ({
  run,
  rows,
}: {
  run: Exclude<ExportRun, { status: "idle" }>;
  rows: readonly ExportRow[];
}) => {
  const exports = useExport();
  const ran = rows.filter((row) => run.rows[row.id] !== undefined);
  const finished = ran.filter((row) => {
    const status = run.rows[row.id];
    return status === "done" || status === "failed";
  }).length;
  const exported = ran.filter((row) => run.rows[row.id] === "done").length;

  return (
    <div role="status" className="flex flex-col">
      {run.status === "exporting" ? (
        <Header
          title={message("export.exporting")}
          end={
            <span className="pr-1 text-ui text-secondary">
              {message("export.position", { position: finished, total: ran.length })}
            </span>
          }
        />
      ) : (
        <Header title={message("export.result", { done: exported, total: ran.length })} />
      )}
      <ul className="flex flex-col py-1">
        {ran.map((row) => (
          <RunRow key={row.id} row={row} status={run.rows[row.id] ?? "waiting"} run={run} />
        ))}
      </ul>
      {run.status === "exporting" ? (
        <div className="flex justify-end border-t border-line-subtle p-2">
          <Button
            variant="outline"
            size="compact"
            aria-disabled={run.stopping || undefined}
            onClick={exports.stop}
          >
            {message("export.stop")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const RunRow = ({
  row,
  status,
  run,
}: {
  row: ExportRow;
  status: ExportRowStatus;
  run: Exclude<ExportRun, { status: "idle" }>;
}) => {
  const exports = useExport();
  const outcome = run.outcomes[row.id];
  const reason = outcome !== undefined && "reason" in outcome ? outcome.reason : null;
  const finished = run.status !== "exporting";

  return (
    <li className="flex flex-col px-2 py-1">
      <div className="flex h-4 items-center gap-1.5 text-ui">
        <span className="flex w-3 shrink-0 justify-center">
          <StatusMark status={status} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            status === "waiting" ? "text-secondary" : "text-primary",
          )}
        >
          {rowLabel(row)}
        </span>
        <RunRowEnd
          status={status}
          finished={finished}
          onReveal={() => void exports.revealRow(row.id)}
          onRetry={() => void exports.exportAll([row.id])}
        />
      </div>
      {reason !== null ? (
        <p role="alert" className="pt-0.5 pl-4.5 text-ui text-error">
          {reason}
        </p>
      ) : null}
    </li>
  );
};

/** Where a row stands, or what can be done with it once the run is over. */
const RunRowEnd = ({
  status,
  finished,
  onReveal,
  onRetry,
}: {
  status: ExportRowStatus;
  finished: boolean;
  onReveal: () => void;
  onRetry: () => void;
}) => {
  if (finished && status === "done") {
    return <RowAction label={message("export.reveal")} onClick={onReveal} />;
  }
  if (finished && status === "failed") {
    return <RowAction label={message("export.retry")} onClick={onRetry} />;
  }
  return <span className="shrink-0 text-secondary">{message(`export.status.${status}`)}</span>;
};

const RowAction = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="shrink-0 text-muted hover:text-primary" onClick={onClick}>
    {label}
  </button>
);

const StatusMark = ({ status }: { status: ExportRowStatus }) => {
  switch (status) {
    case "waiting":
      return <span aria-hidden className="h-1.5 w-1.5 rounded-full ring-1 ring-control-muted" />;
    case "exporting":
      return (
        <span
          aria-hidden
          className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
        />
      );
    case "done":
      return (
        <span aria-hidden className="flex text-state-on">
          <Check className="h-3 w-3" strokeWidth={2.5} />
        </span>
      );
    case "failed":
      return (
        <span aria-hidden className="flex text-error">
          <X className="h-3 w-3" strokeWidth={2.5} />
        </span>
      );
  }
};

function rowLabel(row: ExportRow): string {
  return `${targetLabel(row.target)} · ${outputLabel(row.output)}`;
}

function fileCount(status: "planning" | "ready" | "failed", count: number): string {
  if (status !== "ready") return "";
  return count === 1
    ? message("export.fileCount.one")
    : message("export.fileCount.many", { count });
}
