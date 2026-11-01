import type { LayerReader, SourceReader } from "shift-bridge";
import type { LayerReaderHost } from "../shared/host/ShiftHost";
import type { FontStoreLocation } from "../shared/workspace/lanes";

type ShiftBridge = { LayerReader: typeof LayerReader; SourceReader: typeof SourceReader };

/** An open reader: a document's or working store's layers, or an authored file's glyphs. */
type OpenReader = { kind: "store"; reader: LayerReader } | { kind: "source"; reader: SourceReader };

/**
 * Read-only native layer readers behind opaque handles, because class
 * instances cannot cross the context bridge. The addon loads on the first
 * open, so windows that never edit never load it. The host is a plain object
 * of closures for the same reason: the bridge drops prototype methods.
 */
export function layerReaderHost(): LayerReaderHost {
  const readers = new Map<number, OpenReader>();
  let nextHandle = 1;
  let addon: ShiftBridge | null = null;

  // oxlint-disable-next-line typescript/no-require-imports -- the preload loads the native addon lazily
  const bridge = (): ShiftBridge => (addon ??= require("shift-bridge") as ShiftBridge);
  const openAt = (location: FontStoreLocation): LayerReader => {
    const { LayerReader } = bridge();
    return location.kind === "document"
      ? LayerReader.openDocument(location.documentPath, location.recoveryPath)
      : LayerReader.openWorkingStore(location.storePath);
  };
  const add = (opened: OpenReader): number => {
    const handle = nextHandle++;
    readers.set(handle, opened);
    return handle;
  };
  const reader = (handle: number): OpenReader => {
    const found = readers.get(handle);
    if (!found) throw new Error(`no layer reader ${handle}`);
    return found;
  };
  return {
    open: (location) => add({ kind: "store", reader: openAt(location) }),
    openSource: (path) => add({ kind: "source", reader: bridge().SourceReader.open(path) }),
    sourceDirectory: (handle) => {
      const opened = reader(handle);
      if (opened.kind !== "source") throw new Error(`layer reader ${handle} reads no source file`);
      return opened.reader.directory();
    },
    request: (handle, method, numbers, blobs) =>
      reader(handle).reader.request(method, numbers, [...blobs]),
    close: (handle) => {
      // Release the files now: the workspace deletes them on Save As and close,
      // which Windows refuses while a reader still holds them open.
      readers.get(handle)?.reader.close();
      readers.delete(handle);
    },
  };
}
