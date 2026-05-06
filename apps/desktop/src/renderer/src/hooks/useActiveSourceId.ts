import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/signals";

export const useActiveSourceId = (): string | null => {
  return useSignalState(getEditor().$activeSourceId);
};
