import { getEditor } from "@/store/appStore";
import { useSignalState } from "@/lib/signals";

export const useEditSourceId = (): string | null => {
  return useSignalState(getEditor().$editSourceId);
};
