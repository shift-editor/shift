import type { LayerReader } from "shift-bridge";
import type { LayerReaderHost } from "../shared/host/ShiftHost";
import type { FontStoreLocation } from "../shared/workspace/protocol";

type LayerReaderStatics = typeof LayerReader;

/**
 * Read-only native layer readers behind opaque handles, because class
 * instances cannot cross the context bridge. The addon loads on the first
 * open, so windows that never edit never load it. The host is a plain object
 * of closures for the same reason: the bridge drops prototype methods.
 */
export function layerReaderHost(): LayerReaderHost {
  const readers = new Map<number, LayerReader>();
  let nextHandle = 1;
  let statics: LayerReaderStatics | null = null;

  const openAt = (location: FontStoreLocation): LayerReader => {
    // oxlint-disable-next-line typescript/no-require-imports -- the preload loads the native addon lazily
    statics ??= (require("shift-bridge") as { LayerReader: LayerReaderStatics }).LayerReader;
    return location.kind === "document"
      ? statics.openDocument(location.documentPath, location.recoveryPath)
      : statics.openWorkingStore(location.storePath);
  };
  const reader = (handle: number): LayerReader => {
    const found = readers.get(handle);
    if (!found) throw new Error(`no layer reader ${handle}`);
    return found;
  };
  return {
    open: (location) => {
      const handle = nextHandle++;
      readers.set(handle, openAt(location));
      return handle;
    },
    request: (handle, method, numbers, blobs) =>
      reader(handle).request(method, numbers, [...blobs]),
    close: (handle) => {
      // Release the files now: the workspace deletes them on Save As and close,
      // which Windows refuses while a reader still holds them open.
      readers.get(handle)?.close();
      readers.delete(handle);
    },
  };
}
