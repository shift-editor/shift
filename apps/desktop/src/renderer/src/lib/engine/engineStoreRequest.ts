import type { LayerReaderHost } from "@shared/host/ShiftHost";
import type { StoreRequest } from "@shift/editor/model";

/**
 * The window's read-only layer reader as the editing engine's store: each
 * request the engine encodes goes to the preload's reader unchanged. `reader`
 * names the reader to use at each call, since the store can move under an
 * open session, as after Save As.
 */
export function engineStoreRequest(layers: LayerReaderHost, reader: () => number): StoreRequest {
  return (method, numbers, blobs) => layers.request(reader(), method, numbers, blobs);
}
