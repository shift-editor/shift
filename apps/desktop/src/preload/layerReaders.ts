import type { LayerReader } from "shift-bridge";
import type { LayerReaderHost } from "../shared/host/ShiftHost";
import type { LayerStoreLocation } from "../shared/workspace/protocol";

type LayerReaderClass = typeof LayerReader;

/**
 * Read-only native layer readers behind opaque handles, because class
 * instances cannot cross the context bridge. The addon loads on the first
 * open, so windows that never edit never load it.
 */
export function layerReaderHost(): LayerReaderHost {
  const readers = new Map<number, LayerReader>();
  let nextHandle = 1;
  let readerClass: LayerReaderClass | null = null;

  const native = (): LayerReaderClass => {
    // oxlint-disable-next-line typescript/no-require-imports -- the preload loads the native addon lazily
    readerClass ??= (require("shift-bridge") as { LayerReader: LayerReaderClass }).LayerReader;
    return readerClass;
  };
  const reader = (handle: number): LayerReader => {
    const found = readers.get(handle);
    if (!found) throw new Error(`no layer reader ${handle}`);
    return found;
  };

  return {
    open: (location: LayerStoreLocation) => {
      const LayerReaderClass = native();
      const opened =
        location.kind === "document"
          ? LayerReaderClass.openDocument(location.documentPath, location.recoveryPath)
          : LayerReaderClass.openWorkingStore(location.storePath);
      const handle = nextHandle++;
      readers.set(handle, opened);
      return handle;
    },
    load: (handle, layerIds) => {
      const bytes = reader(handle).loadLayers([...layerIds]);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    componentClosure: (handle, glyphIds) => reader(handle).componentClosure([...glyphIds]),
    dependents: (handle, layerIds) => reader(handle).dependents([...layerIds]),
    close: (handle) => {
      readers.delete(handle);
    },
  };
}
