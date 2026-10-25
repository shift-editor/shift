import type { LayerReaderHost } from "@shared/host/ShiftHost";
import type { EngineLayerSource } from "@shift/editor/model";

/** The window's read-only layer reader as the editing engine's source. */
export function engineLayerSource(layers: LayerReaderHost, reader: number): EngineLayerSource {
  return {
    load: (layerIds) => layers.load(reader, layerIds),
    componentClosure: (glyphIds) => layers.componentClosure(reader, glyphIds),
    dependents: (layerIds) => layers.dependents(reader, layerIds),
  };
}
