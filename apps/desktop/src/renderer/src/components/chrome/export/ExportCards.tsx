import type { ReactNode } from "react";
import { message } from "@shared/messages";
import FileIcon from "@assets/export/export-static.svg";
import FolderIcon from "@assets/export/folder.svg";
import { pathName } from "@/lib/export/exportPaths";
import type { ExportPlan } from "@/hooks/useExportPlan";

/** A titled white card in the Export dialog's pane. */
export const ExportSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-ui font-medium text-primary">{title}</h3>
    <div className="flex flex-col rounded-md border border-chrome bg-surface">{children}</div>
  </section>
);

/** One row of an Export dialog card. */
export const ExportRow = ({ children }: { children: ReactNode }) => (
  <div className="flex h-9 min-w-0 items-center gap-2 border-t border-chrome px-3 text-ui text-primary first:border-t-0">
    {children}
  </div>
);

/**
 * The files an export writes, one per row: binaries and designspaces as
 * files, UFOs as folders, since a UFO is a folder.
 */
export const ExportFilesCard = ({ plan, choices }: { plan: ExportPlan; choices?: ReactNode }) => (
  <ExportSection title={message("export.section.files")}>
    {choices}
    <ExportFileRows plan={plan} />
  </ExportSection>
);

const ExportFileRows = ({ plan }: { plan: ExportPlan }) => {
  switch (plan.status) {
    case "planning":
      return <ExportRow>{message("export.files.planning")}</ExportRow>;
    case "failed":
      return <ExportRow>{plan.reason}</ExportRow>;
    case "ready":
      return plan.files.map((file) => {
        const name = pathName(file);
        const Icon = name.toLowerCase().endsWith(".ufo") ? FolderIcon : FileIcon;
        return (
          <ExportRow key={file}>
            <Icon aria-hidden className="h-4 w-4 shrink-0 text-secondary" />
            <span className="truncate" title={file}>
              {name}
            </span>
          </ExportRow>
        );
      });
  }
};
