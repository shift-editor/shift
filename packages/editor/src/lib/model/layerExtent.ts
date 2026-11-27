import type { LayerExtent, LayerExtentReadError } from "@shift/wasm/protocol";
import type { LayerId } from "@shift/types";

/** A layer whose extent could not be read yet. */
export interface UnreadLayerExtent {
  readonly kind: "unread";
  readonly layerId: LayerId;
  readonly reason: string | null;
}

export type LayerExtentRead = LayerExtent | UnreadLayerExtent;

export function isUnreadLayerExtent(extent: LayerExtentRead): extent is UnreadLayerExtent {
  return "kind" in extent && extent.kind === "unread";
}

/**
 * Reads one layer's extent from the engine.
 *
 * @remarks
 * A layer that is not loaded yet is unread, not an error thrown through
 * reactive readers. Other failures carry a reason for the UI fallback.
 */
export function readLayerExtent(layerId: LayerId, read: () => LayerExtent): LayerExtentRead {
  try {
    return read();
  } catch (error) {
    const readError = layerExtentReadError(error);
    if (readError?.kind === "notLoaded") {
      return { kind: "unread", layerId, reason: null };
    }

    return {
      kind: "unread",
      layerId: readError?.kind === "layerNotFound" ? readError.layer : layerId,
      reason: layerExtentFailureMessage(error, readError),
    };
  }
}

function layerExtentReadError(error: unknown): LayerExtentReadError | null {
  if (typeof error !== "object" || error === null) return null;
  const { type, error: carried } = error as { readonly type?: unknown; readonly error?: unknown };
  if (type !== "LayerExtentReadError") return null;

  return carried as LayerExtentReadError;
}

function layerExtentFailureMessage(error: unknown, readError: LayerExtentReadError | null): string {
  switch (readError?.kind) {
    case "failed":
      return readError.message;
    case "layerNotFound":
      return "Its layer is not in the font.";
    case "notLoaded":
      return "Its layer is not loaded.";
    case undefined:
      return error instanceof Error ? error.message : "The layer extent could not be read.";
  }
}
