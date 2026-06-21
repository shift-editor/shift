import { getEditor } from "@/store/appStore";
import { useSignalState } from "@/lib/signals";

export const useLayerSourceId = (): string | null => {
  return useSignalState(getEditor().$layerSourceId);
};
