import { useEffect, useState } from "react";
import { useSignalState } from "@shift/editor/signals";
import type { WorkspaceExportFormat } from "@shared/workspace/lanes";
import { useAxes } from "@/hooks/useAxes";
import type { Workspace } from "@/workspace/Workspace";
import { useFont } from "@/workspace/WorkspaceContext";

/** The files an export would write, as the workspace names them. */
export type ExportPlan =
  | { status: "planning" }
  | { status: "ready"; files: readonly string[] }
  | { status: "failed"; reason: string };

/**
 * Asks the workspace which files exporting as `format` into `folder` writes,
 * again whenever anything those names come from changes: the family and
 * style names, the masters, the named instances, or the axes.
 *
 * @param folder - The export folder, or null to plan bare file names.
 */
export function useExportPlan(
  workspace: Workspace,
  format: WorkspaceExportFormat,
  folder: string | null,
): ExportPlan {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const sources = useSignalState(font.sourcesCell);
  const instances = useSignalState(font.namedInstancesCell);
  const axes = useAxes();
  const [plan, setPlan] = useState<ExportPlan>({ status: "planning" });

  useEffect(() => {
    let current = true;
    setPlan({ status: "planning" });
    const request = { directory: folder ?? "", format, mode: "plan" } as const;
    const answer = async () => {
      try {
        const { files } = await workspace.editCoordinator.export(request);
        if (current) setPlan({ status: "ready", files });
      } catch (error) {
        if (current) setPlan({ status: "failed", reason: errorReason(error) });
      }
    };
    void answer();
    return () => {
      current = false;
    };
  }, [workspace, format, folder, metadata, sources, instances, axes]);

  return plan;
}

/** The message an export failure carries, for showing under a generic headline. */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
