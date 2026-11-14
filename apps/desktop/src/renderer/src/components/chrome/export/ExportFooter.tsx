import { Button } from "@shift/ui";
import { message } from "@shared/messages";
import FolderIcon from "@assets/export/folder.svg";
import { folderBreadcrumb } from "@/lib/export/exportPaths";

/** Where an Export dialog run stands. */
export type ExportRun =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "done" }
  | { status: "failed"; reason: string };

interface ExportFooterProps {
  folder: string | null;
  run: ExportRun;
  canExport: boolean;
  onChooseFolder: () => void;
  onExport: () => void;
}

/** The Export dialog's destination folder, its chooser, and the Export action. */
export const ExportFooter = ({
  folder,
  run,
  canExport,
  onChooseFolder,
  onExport,
}: ExportFooterProps) => (
  <footer className="flex flex-col gap-2 border-t border-line-subtle px-6 py-3">
    <ExportRunStatus run={run} />
    <div className="flex items-center gap-2">
      <div
        aria-label={message("export.folder.label")}
        title={folder ?? undefined}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded bg-input px-2 text-ui text-primary"
      >
        <FolderIcon aria-hidden className="h-4 w-4 shrink-0 text-secondary" />
        <span className="truncate">
          {folder === null ? message("export.folder.none") : folderBreadcrumb(folder).join(" › ")}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onChooseFolder}>
        {message("export.folder.choose")}
      </Button>
      <Button variant="primary" size="sm" disabled={!canExport} onClick={onExport}>
        {run.status === "exporting" ? message("export.exporting") : message("export.action")}
      </Button>
    </div>
  </footer>
);

const ExportRunStatus = ({ run }: { run: ExportRun }) => {
  switch (run.status) {
    case "idle":
    case "exporting":
      return null;
    case "done":
      return (
        <p role="status" className="text-ui text-secondary">
          {message("export.done")}
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="text-ui text-primary">
          {message("export.failed")} <span className="text-secondary">{run.reason}</span>
        </p>
      );
  }
};
