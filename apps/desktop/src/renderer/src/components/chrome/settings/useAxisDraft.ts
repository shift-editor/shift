import { useMemo } from "react";
import { Axis } from "@shift/editor/model";
import type { Axis as AxisRecord } from "@shift/types";
import { message } from "@shared/messages";
import { useFont } from "@/workspace/WorkspaceContext";
import type { AxisDraft } from "./types";
import { useSettingsForm } from "./useSettingsForm";

export function useAxisDraft(axis: Axis): AxisDraft {
  const font = useFont();
  const form = useSettingsForm<AxisRecord>({
    canonical: axis.record,
    errorMessage: message("settings.axisSaveFailed"),
    save: async (next) => {
      await font.updateAxis(next);
      return font.axis(next.id)?.record ?? next;
    },
  });
  const draft = useMemo(() => new Axis(form.draft), [form.draft]);

  return {
    axis: draft,
    error: form.error,
    update: form.update,
    commit: form.commit,
    updateAndCommit: form.updateAndCommit,
  };
}
