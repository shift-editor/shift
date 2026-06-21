import { describe, expect, it } from "vitest";
import type {
  Axis,
  AxisId,
  ComponentId,
  GlyphId,
  GlyphName,
  GlyphState,
  LayerId,
  SourceId,
  Unicode,
} from "@shift/types";
import type {
  WorkspaceGlyphSnapshot,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import { FontStore, type FontStoreSyncPort } from "./FontStore";
import { GlyphSnapshotLoader, type GlyphSnapshotSyncPort } from "./GlyphSnapshotLoader";

const SOURCE_ID = "source_regular" as SourceId;
const AXIS_ID = "axis_weight" as AxisId;
const GLYPH_A_ID = "glyph_a" as GlyphId;
const GLYPH_B_ID = "glyph_b" as GlyphId;
const LAYER_A_ID = "layer_a" as LayerId;
const LAYER_B_ID = "layer_b" as LayerId;

describe("glyph snapshot loading follows component dependencies", () => {
  it("loads component base glyph snapshots discovered from loaded geometry", async () => {
    const store = new FontStore(workspaceSnapshot());
    const sync = new SnapshotFixtureSync(store.sync, [glyphSnapshotA(), glyphSnapshotB()]);
    const loader = new GlyphSnapshotLoader(store.glyphSnapshots, sync);

    await loader.load([GLYPH_A_ID]);

    expect(store.glyphSnapshots.snapshotStatus(GLYPH_A_ID)).toBe("loaded");
    expect(store.glyphSnapshots.snapshotStatus(GLYPH_B_ID)).toBe("loaded");
    expect(store.layerState(LAYER_A_ID)?.geometry.components[0]?.baseGlyphId).toBe(GLYPH_B_ID);
    expect(store.layerState(LAYER_B_ID)?.xAdvance).toBe(500);
  });

  it("settles queued workspace edits before checking snapshot freshness", async () => {
    const store = new FontStore(workspaceSnapshot());
    const generation = store.sync.markSnapshotsLoading([GLYPH_A_ID]);
    store.sync.applyGlyphSnapshots([GLYPH_A_ID], [glyphSnapshotA(600)], generation);
    const sync = new SnapshotFixtureSync(
      store.sync,
      [glyphSnapshotA(700), glyphSnapshotB()],
      () => {
        store.sync.foldAppliedChange({ layers: [], axes: [weightAxis()], dependents: [] });
      },
    );
    const loader = new GlyphSnapshotLoader(store.glyphSnapshots, sync);

    await loader.load([GLYPH_A_ID]);

    expect(store.glyphSnapshots.snapshotStatus(GLYPH_A_ID)).toBe("loaded");
    expect(store.layerState(LAYER_A_ID)?.xAdvance).toBe(700);
  });
});

class SnapshotFixtureSync implements GlyphSnapshotSyncPort {
  readonly #store: FontStoreSyncPort;
  readonly #snapshots: ReadonlyMap<GlyphId, WorkspaceGlyphSnapshot>;
  readonly #settle: () => void;

  constructor(
    store: FontStoreSyncPort,
    snapshots: readonly WorkspaceGlyphSnapshot[],
    settle: () => void = () => {},
  ) {
    this.#store = store;
    this.#snapshots = new Map(snapshots.map((snapshot) => [snapshot.glyphId, snapshot]));
    this.#settle = settle;
  }

  async settled(): Promise<void> {
    this.#settle();
  }

  async loadGlyphSnapshots(requests: readonly WorkspaceGlyphSnapshotRequest[]): Promise<void> {
    const glyphIds = requests.map((request) => request.glyphId);
    const generation = this.#store.markSnapshotsLoading(glyphIds);
    const snapshots = glyphIds
      .map((glyphId) => this.#snapshots.get(glyphId))
      .filter((snapshot): snapshot is WorkspaceGlyphSnapshot => Boolean(snapshot));

    this.#store.applyGlyphSnapshots(glyphIds, snapshots, generation);
  }
}

function workspaceSnapshot(): WorkspaceSnapshot {
  return {
    documentId: "document",
    metadata: { familyName: "Untitled Font" },
    metrics: { unitsPerEm: 1000, ascender: 800, descender: -200 },
    glyphs: [
      {
        id: GLYPH_A_ID,
        name: "A" as GlyphName,
        unicodes: [65 as Unicode],
        componentBaseGlyphIds: [GLYPH_B_ID],
        layers: [{ id: LAYER_A_ID, sourceId: SOURCE_ID }],
      },
      {
        id: GLYPH_B_ID,
        name: "B" as GlyphName,
        unicodes: [66 as Unicode],
        componentBaseGlyphIds: [],
        layers: [{ id: LAYER_B_ID, sourceId: SOURCE_ID }],
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

function glyphSnapshotA(xAdvance = 600): WorkspaceGlyphSnapshot {
  return {
    glyphId: GLYPH_A_ID,
    layers: [
      {
        glyphId: GLYPH_A_ID,
        sourceId: SOURCE_ID,
        state: componentGlyphState(xAdvance),
      },
    ],
  };
}

function glyphSnapshotB(): WorkspaceGlyphSnapshot {
  return {
    glyphId: GLYPH_B_ID,
    layers: [
      {
        glyphId: GLYPH_B_ID,
        sourceId: SOURCE_ID,
        state: simpleGlyphState(LAYER_B_ID),
      },
    ],
  };
}

function componentGlyphState(xAdvance: number): GlyphState {
  return {
    layerId: LAYER_A_ID,
    structure: {
      contours: [],
      anchors: [],
      components: [
        {
          id: "component_b" as ComponentId,
          baseGlyphId: GLYPH_B_ID,
          baseGlyphName: "B" as GlyphName,
        },
      ],
    },
    values: new Float64Array([xAdvance, 0, 0, 0, 1, 1, 0, 0, 0, 0]),
  };
}

function simpleGlyphState(layerId: LayerId): GlyphState {
  return {
    layerId,
    structure: { contours: [], anchors: [], components: [] },
    values: new Float64Array([500]),
  };
}

function weightAxis(): Axis {
  return {
    id: AXIS_ID,
    tag: "wght",
    name: "Weight",
    min: 100,
    default: 400,
    max: 900,
    hidden: false,
  };
}
