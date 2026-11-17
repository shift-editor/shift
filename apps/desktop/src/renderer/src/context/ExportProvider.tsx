import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSignalState } from "@shift/editor/signals";
import { getShiftHost } from "@/host/shiftHost";
import { errorReason } from "@/lib/export/errorReason";
import { ExportFolders } from "@/lib/export/ExportFolders";
import { ExportSetup, newRowId } from "@/lib/export/ExportSetup";
import {
  EXPORT_TARGETS,
  exportRequestFor,
  outputsFor,
  type ExportRow,
  type ExportTarget,
} from "@/types/export";
import type { Workspace } from "@/workspace/Workspace";
import { useFontSession } from "@/workspace/WorkspaceContext";
import {
  ExportContext,
  type ExportControls,
  type ExportRowOutcome,
  type ExportRowStatus,
  type ExportRun,
} from "./ExportContext";

/**
 * Holds the open document's Export rows and runs them, for the Export section
 * in both Home's and the editor's left sidebars, so both show the same run.
 */
export const ExportProvider = ({ children }: { children: ReactNode }) => {
  const session = useFontSession();
  if (session.mode !== "workspace") {
    return <PreviewExportProvider>{children}</PreviewExportProvider>;
  }

  return (
    <WorkspaceExportProvider workspace={session.workspace}>{children}</WorkspaceExportProvider>
  );
};

/** A preview can't be exported until it is saved as a .shift document; its rows only show. */
const PreviewExportProvider = ({ children }: { children: ReactNode }) => {
  const setup = useMemo(() => new ExportSetup(), []);
  const [open, setOpen] = useState(true);
  const controls = useMemo<ExportControls>(
    () => ({
      rows: setup.rows(null),
      run: { status: "idle" },
      open,
      setOpen,
      addRow: () => {},
      updateRow: () => {},
      removeRow: () => {},
      folder: () => null,
      chooseFolder: async () => {},
      popoverOpen: false,
      setPopoverOpen: () => {},
      exportAll: async () => {},
      stop: () => {},
      revealRow: async () => {},
      dismiss: () => {},
    }),
    [open, setup],
  );

  return <ExportContext.Provider value={controls}>{children}</ExportContext.Provider>;
};

const WorkspaceExportProvider = ({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) => {
  const document = useSignalState(workspace.documentStateCell);
  const documentKey = document === null ? null : (document.saveTarget ?? "unsaved");
  const setup = useMemo(() => new ExportSetup(), []);
  const folders = useMemo(() => new ExportFolders(), []);
  const [rows, setRows] = useState<readonly ExportRow[]>(() => setup.rows(document));
  const [open, setOpenState] = useState(() => setup.isOpen(document));
  const [chosen, setChosen] = useState<Partial<Record<ExportTarget, string>>>({});
  const [run, setRun] = useState<ExportRun>({ status: "idle" });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const stopping = useRef(false);
  const documentRef = useRef(document);
  documentRef.current = document;

  // A different document (or the first save of this one) brings its own rows and folders.
  useEffect(() => {
    const current = documentRef.current;
    setRows(setup.rows(current));
    setOpenState(setup.isOpen(current));
    setChosen({});
  }, [documentKey, setup]);

  const changeRows = useCallback(
    (change: (rows: readonly ExportRow[]) => readonly ExportRow[]) => {
      setRows((previous) => {
        const next = change(previous);
        const current = documentRef.current;
        if (current !== null) setup.rememberRows(current, next);
        return next;
      });
      setRun((previous) => (previous.status === "exporting" ? previous : { status: "idle" }));
    },
    [setup],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      const current = documentRef.current;
      if (current !== null) setup.rememberOpen(current, next);
    },
    [setup],
  );

  const folder = useCallback(
    (target: ExportTarget) => {
      const picked = chosen[target];
      if (picked !== undefined) return picked;
      return document === null ? null : folders.folder(document, target);
    },
    [chosen, document, folders],
  );

  const remember = useCallback(
    (target: ExportTarget, picked: string) => {
      setChosen((previous) => ({ ...previous, [target]: picked }));
      const current = documentRef.current;
      if (current !== null) folders.remember(current, target, picked);
    },
    [folders],
  );

  const askForFolder = useCallback(
    async (target: ExportTarget): Promise<string | null> => {
      const picked = await getShiftHost().exports.chooseFolder(folder(target));
      if (picked !== null) remember(target, picked);
      return picked;
    },
    [folder, remember],
  );

  const exportAll = useCallback(
    async (only?: readonly string[]) => {
      if (run.status === "exporting") return;
      const chosenRows = only === undefined ? rows : rows.filter((row) => only.includes(row.id));
      if (chosenRows.length === 0) return;

      const statuses: Record<string, ExportRowStatus> = {};
      const outcomes: Record<string, ExportRowOutcome> = {};
      for (const row of chosenRows) statuses[row.id] = "waiting";
      const show = (next: Partial<Record<string, ExportRowStatus>>) =>
        setRun({
          status: "exporting",
          rows: { ...Object.assign(statuses, next) },
          outcomes: { ...outcomes },
          stopping: stopping.current,
        });

      stopping.current = false;
      show({});
      // Folders chosen during this run, so two rows of one target ask only once.
      const directories: Partial<Record<ExportTarget, string>> = {};

      for (const row of chosenRows) {
        if (stopping.current) break;

        const directory =
          directories[row.target] ?? folder(row.target) ?? (await askForFolder(row.target));
        if (directory === null) {
          setRun({ status: "idle" });
          return;
        }
        directories[row.target] = directory;

        show({ [row.id]: "exporting" });
        try {
          const result = await workspace.editCoordinator.export({
            directory,
            mode: "write",
            ...exportRequestFor(row),
          });
          remember(row.target, directory);
          outcomes[row.id] = { written: result.path };
          show({ [row.id]: "done" });
        } catch (error) {
          outcomes[row.id] = { reason: errorReason(error) };
          show({ [row.id]: "failed" });
        }
      }

      const failed = Object.values(outcomes).some((outcome) => "reason" in outcome);
      if (failed) setOpen(true);
      if (Object.keys(outcomes).length === 0) {
        setRun({ status: "idle" });
        return;
      }
      setRun({
        status: failed ? "failed" : "done",
        rows: { ...statuses },
        outcomes: { ...outcomes },
      });
    },
    [askForFolder, folder, remember, rows, run.status, setOpen, workspace],
  );

  const controls = useMemo<ExportControls>(
    () => ({
      rows,
      run,
      open,
      setOpen,
      addRow: () => changeRows((previous) => [...previous, nextRow(previous)]),
      updateRow: (id, row) =>
        changeRows((previous) =>
          previous.map((existing) => (existing.id === id ? { ...existing, ...row } : existing)),
        ),
      removeRow: (id) => changeRows((previous) => previous.filter((row) => row.id !== id)),
      folder,
      chooseFolder: async (target) => {
        await askForFolder(target);
      },
      popoverOpen,
      setPopoverOpen,
      exportAll,
      stop: () => {
        stopping.current = true;
        setRun((previous) =>
          previous.status === "exporting" ? { ...previous, stopping: true } : previous,
        );
      },
      revealRow: async (id) => {
        const outcome = run.status === "idle" ? undefined : run.outcomes[id];
        if (outcome !== undefined && "written" in outcome) {
          await getShiftHost().exports.reveal(outcome.written);
        }
      },
      dismiss: () =>
        setRun((previous) => (previous.status === "exporting" ? previous : { status: "idle" })),
    }),
    [askForFolder, changeRows, exportAll, folder, open, popoverOpen, rows, run, setOpen],
  );

  return <ExportContext.Provider value={controls}>{children}</ExportContext.Provider>;
};

/** The first target and output not already a row, or another variable TrueType when all are. */
function nextRow(rows: readonly ExportRow[]): ExportRow {
  for (const target of EXPORT_TARGETS) {
    for (const output of outputsFor[target]) {
      const taken = rows.some((row) => row.target === target && row.output === output);
      if (!taken) return { id: newRowId(), target, output };
    }
  }
  return { id: newRowId(), target: "variable", output: "ttf" };
}
