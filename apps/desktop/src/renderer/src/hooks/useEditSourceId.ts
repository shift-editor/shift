import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/signals";

export const useEditSourceId = (): string | null => {
  return useSignalState(getEditor().$editSourceId);
};
