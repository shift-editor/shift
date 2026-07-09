import { getShiftHost } from "@/host/shiftHost";
import { Workspace } from "./Workspace";
import { electronSystemClipboard } from "@/lib/clipboard";

declare global {
  var shiftWorkspace: Workspace | null;
}

export function getWorkspace(): Workspace {
  globalThis.shiftWorkspace ??= new Workspace({
    host: getShiftHost(),
    clipboard: electronSystemClipboard,
  });

  return globalThis.shiftWorkspace;
}
