import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Tooltip,
  X,
  cn,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import { message } from "@shared/messages";
import { useSettingsNavigation } from "@/context/SettingsNavigationContext";
import { getShiftHost } from "@/host/shiftHost";
import { useAxes } from "@/hooks/useAxes";
import { errorReason, useExportPlan } from "@/hooks/useExportPlan";
import { useMemberSet } from "@/hooks/useMemberSet";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import { ExportFolders } from "@/lib/export/ExportFolders";
import type { WorkspaceBinaryEncoding } from "@shared/workspace/lanes";
import {
  BINARY_ENCODINGS,
  exportFormatFor,
  writesBinaries,
  type ExportTarget,
} from "@/types/export";
import type { Workspace } from "@/workspace/Workspace";
import { useFont, useFontSession } from "@/workspace/WorkspaceContext";
import { ExportFilesCard, ExportRow, ExportSection } from "./ExportCards";
import { ExportFooter, type ExportRun } from "./ExportFooter";
import { ExportSidebar, exportTargetName } from "./ExportSidebar";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Exports the open font as a variable binary, static binaries, or editable
 * sources, into a folder remembered per target and per document.
 *
 * @remarks
 * Rust names every file; the dialog lists what the selected target writes
 * and writes only that target. Exporting never changes the document's save
 * target or dirty state.
 */
export const ExportDialog = ({ open, onOpenChange }: ExportDialogProps) => {
  const font = useFont();
  const session = useFontSession();
  if (!font.loaded || session.mode !== "workspace") return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 h-125",
            "w-200 max-w-none -translate-x-1/2 -translate-y-1/2",
            "grid grid-cols-[9.5rem_minmax(0,1fr)] overflow-hidden",
            "border border-line-subtle bg-surface-muted",
          )}
        >
          <DialogTitle className="sr-only">{message("export.dialog.title")}</DialogTitle>
          <ExportDialogBody workspace={session.workspace} />
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

const ExportDialogBody = ({ workspace }: { workspace: Workspace }) => {
  const document = useSignalState(workspace.documentStateCell);
  const folders = useMemo(() => new ExportFolders(), []);
  const [target, setTarget] = useState<ExportTarget>("variable");
  const [chosen, setChosen] = useState<Partial<Record<ExportTarget, string>>>({});
  const [run, setRun] = useState<ExportRun>({ status: "idle" });
  const folder = chosen[target] ?? (document === null ? null : folders.folder(document, target));
  const format = exportFormatFor[target];
  const chosenEncodings = useMemberSet<WorkspaceBinaryEncoding>(["ttf"]);
  const encodings = useMemo(
    () => BINARY_ENCODINGS.filter((encoding) => chosenEncodings.values.has(encoding)),
    [chosenEncodings.values],
  );
  const plan = useExportPlan(workspace, format, encodings, folder);
  const needsInstances = useNeedsInstances(target);
  const canExport =
    folder !== null && plan.status === "ready" && !needsInstances && run.status !== "exporting";

  const changeTarget = (next: ExportTarget) => {
    setTarget(next);
    setRun({ status: "idle" });
  };

  const chooseFolder = async () => {
    try {
      const picked = await getShiftHost().exports.chooseFolder(folder);
      if (picked === null) return;
      setChosen((previous) => ({ ...previous, [target]: picked }));
      setRun({ status: "idle" });
      if (document !== null) folders.remember(document, target, picked);
    } catch (error) {
      setRun({ status: "failed", reason: errorReason(error) });
    }
  };

  const exportTarget = async () => {
    if (folder === null) return;
    setRun({ status: "exporting" });
    try {
      await workspace.editCoordinator.export({
        directory: folder,
        format,
        mode: "write",
        encodings,
      });
      if (document !== null) folders.remember(document, target, folder);
      setRun({ status: "done" });
    } catch (error) {
      setRun({ status: "failed", reason: errorReason(error) });
    }
  };

  return (
    <>
      <ExportSidebar target={target} onTargetChange={changeTarget} />
      <main
        aria-label={message("export.dialog.details")}
        className="relative flex min-h-0 min-w-0 flex-col bg-surface-muted"
      >
        <Tooltip content={message("export.dialog.close")}>
          <DialogClose
            variant="icon"
            className="absolute right-2 top-2 z-10 h-7 w-7"
            aria-label={message("export.dialog.close")}
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </Tooltip>
        <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-4">
          <h2 className="text-sm font-medium text-primary">{exportTargetName(target)}</h2>
          {needsInstances ? (
            <NoInstances />
          ) : (
            <ExportFilesCard
              plan={plan}
              choices={
                writesBinaries(target) && (
                  <EncodingChoices
                    chosen={encodings}
                    onChange={(encoding, chosen) => {
                      chosenEncodings.set(encoding, chosen);
                      setRun({ status: "idle" });
                    }}
                  />
                )
              }
            />
          )}
          {target === "ufo" && <UfoFormat />}
        </div>
        <ExportFooter
          folder={folder}
          run={run}
          canExport={canExport}
          onChooseFolder={() => void chooseFolder()}
          onExport={() => void exportTarget()}
        />
      </main>
    </>
  );
};

/** Whether `target` is static export of a variable font that has no named instances to export. */
function useNeedsInstances(target: ExportTarget): boolean {
  const axes = useAxes();
  const instances = useNamedInstances();
  return target === "static" && axes.length > 0 && instances.length === 0;
}

const NoInstances = () => {
  const settings = useSettingsNavigation();
  return (
    <ExportSection title={message("export.section.files")}>
      <div className="flex items-center justify-between gap-4 px-3 py-3 text-ui text-secondary">
        {message("export.static.noInstances")}
        <Button
          variant="outline"
          size="sm"
          onClick={() => settings.open({ category: "instances" })}
        >
          {message("export.static.addInstances")}
        </Button>
      </div>
    </ExportSection>
  );
};

/**
 * The encodings each binary is written in. The last one chosen cannot be
 * cleared, since an export must write something.
 */
const EncodingChoices = ({
  chosen,
  onChange,
}: {
  chosen: readonly WorkspaceBinaryEncoding[];
  onChange: (encoding: WorkspaceBinaryEncoding, chosen: boolean) => void;
}) => (
  <ExportRow>
    {BINARY_ENCODINGS.map((encoding) => {
      const checked = chosen.includes(encoding);
      const onlyChoice = checked && chosen.length === 1;
      return (
        <label key={encoding} className="mr-3 flex items-center gap-1.5 font-mono text-ui">
          <Checkbox
            checked={checked}
            disabled={onlyChoice}
            onCheckedChange={(next) => onChange(encoding, next)}
          />
          .{encoding}
        </label>
      );
    })}
  </ExportRow>
);

const UfoFormat = () => (
  <ExportSection title={message("export.section.format")}>
    <ExportRow>
      <span className="flex-1">{message("export.ufo.version")}</span>
      <span className="text-secondary">{message("export.ufo.versionValue")}</span>
    </ExportRow>
  </ExportSection>
);
