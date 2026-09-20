import type { NamedInstance } from "@shift/types";
import { useSignalState } from "@shift/editor/lib/signals/index";
import { useFont } from "@/workspace/WorkspaceContext";

/** Returns explicit product presets in their authored order. */
export const useNamedInstances = (): NamedInstance[] => {
  const font = useFont();
  return useSignalState(font.namedInstancesCell);
};
