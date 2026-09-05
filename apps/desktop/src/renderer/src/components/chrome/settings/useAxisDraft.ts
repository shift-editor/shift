import type { Axis } from "@shift/types";
import { message } from "@shared/messages";
import { useFont } from "@/workspace/WorkspaceContext";
import type { AxisDraft, AxisTransform } from "./types";
import { useSettingsForm } from "./useSettingsForm";

export function useAxisDraft(axis: Axis): AxisDraft {
  const font = useFont();
  const form = useSettingsForm<Axis>({
    canonical: axis,
    errorMessage: message("settings.axisSaveFailed"),
    save: async (next) => {
      await font.updateAxis(next);
      return font.getAxes().find((candidate) => candidate.id === next.id) ?? next;
    },
  });

  return {
    axis: form.draft,
    error: form.error,
    update: form.update as (transform: AxisTransform) => Axis,
    commit: form.commit,
    updateAndCommit: form.updateAndCommit,
  };
}
