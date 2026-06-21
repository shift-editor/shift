import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName, GlyphState, LayerId, SourceId, Unicode } from "@shift/types";
import type { WorkspaceGlyphSnapshot, WorkspaceSnapshot } from "@shared/workspace/protocol";
import { FontStore } from "./FontStore";

const GLYPH_ID = "glyph_shared" as GlyphId;
const SOURCE_ID = "source_regular" as SourceId;
const LAYER_A_ID = "layer_a" as LayerId;
const LAYER_B_ID = "layer_b" as LayerId;

describe("FontStore snapshot freshness", () => {
  it("ignores stale snapshot responses after a workspace replacement", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    const generation = store.sync.markSnapshotsLoading([GLYPH_ID]);

    store.sync.replaceWorkspace(snapshot("document-b", LAYER_B_ID));
    store.sync.applyGlyphSnapshots([GLYPH_ID], [glyphSnapshot(LAYER_A_ID)], generation);

    expect(store.glyphSnapshots.snapshotStatus(GLYPH_ID)).toBe("missing");
    expect(store.layerState(LAYER_A_ID)).toBeNull();
    expect(store.layerState(LAYER_B_ID)).toBeNull();
  });

  it("marks snapshot request failures against the matching workspace generation", () => {
    const store = new FontStore(snapshot("document-a", LAYER_A_ID));
    const generation = store.sync.markSnapshotsLoading([GLYPH_ID]);

    store.sync.markSnapshotsFailed([GLYPH_ID], generation);

    expect(store.glyphSnapshots.snapshotStatus(GLYPH_ID)).toBe("failed");
  });
});

function snapshot(documentId: string, layerId: LayerId): WorkspaceSnapshot {
  return {
    documentId,
    metadata: { familyName: "Untitled Font" },
    metrics: { unitsPerEm: 1000, ascender: 800, descender: -200 },
    glyphs: [
      {
        id: GLYPH_ID,
        name: "A" as GlyphName,
        unicodes: [65 as Unicode],
        componentBaseGlyphIds: [],
        layers: [{ id: layerId, sourceId: SOURCE_ID }],
      },
    ],
    sources: [
      {
        id: SOURCE_ID,
        name: "Regular",
        location: { values: {} },
      },
    ],
    axes: [],
  };
}

function glyphSnapshot(layerId: LayerId): WorkspaceGlyphSnapshot {
  return {
    glyphId: GLYPH_ID,
    layers: [
      {
        glyphId: GLYPH_ID,
        sourceId: SOURCE_ID,
        state: glyphState(layerId),
      },
    ],
  };
}

function glyphState(layerId: LayerId): GlyphState {
  return {
    layerId,
    structure: { contours: [], anchors: [], components: [] },
    values: new Float64Array([600]),
  };
}
