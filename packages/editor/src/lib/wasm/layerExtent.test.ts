import { describe, expect, it } from "vitest";
import {
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  type FontIntent,
  type LayerId,
  type SourceId,
} from "@shift/types";
import type { LayerExtent } from "@shift/wasm/protocol";
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { isUnreadLayerExtent, type LayerExtentRead } from "../model/layerExtent";
import { SessionEngine } from "../engine/SessionEngine";
import { MemoryClipboard } from "../../testing/emptyMemorySession";

function requireLayerExtent(extent: LayerExtentRead): LayerExtent {
  if (isUnreadLayerExtent(extent)) {
    throw new Error(extent.reason ?? "extent unread");
  }

  return extent;
}

describe("layer extent", () => {
  it("reads ink sidebearings after SetLiveStroke", async () => {
    const layerId = mintLayerId();
    const { session, dispose } = await strokeExtentSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId: mintContourId(),
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      const extent = requireLayerExtent(session.font.layerExtent(layerId));
      expect(extent.effective).toBe("ink");
      expect(extent.ink).not.toBeNull();
      expect(extent.skeleton.minX).toBeCloseTo(0, 0);
      expect(extent.minX).toBeLessThan(extent.skeleton.minX);
    } finally {
      dispose();
    }
  });

  it("lets reapply linked metrics ask the engine without throwing", async () => {
    const layerId = mintLayerId();
    const { session, dispose } = await strokeExtentSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId: mintContourId(),
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      expect(() => session.font.reapplyLinkedMetricsDisabledReason({ kind: "font" })).not.toThrow();
    } finally {
      dispose();
    }
  });

  it("re-derives when include stroke flips", async () => {
    const layerId = mintLayerId();
    const { session, engine, dispose } = await strokeExtentSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId: mintContourId(),
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      const ink = requireLayerExtent(session.font.layerExtent(layerId));
      engine.beginEdit(null);
      engine.apply([{ kind: "setIgnoreStroke", setIgnoreStroke: { ignore: true } }]);
      engine.endEdit();
      const skeleton = requireLayerExtent(session.font.layerExtent(layerId));
      expect(skeleton.effective).toBe("skeleton");
      expect(skeleton.minX).toBeGreaterThan(ink.minX);
    } finally {
      dispose();
    }
  });
});

async function strokeExtentSession(options: {
  layerId: LayerId;
  glyphId: ReturnType<typeof mintGlyphId>;
  contourId: ReturnType<typeof mintContourId>;
  startId: ReturnType<typeof mintPointId>;
  endId: ReturnType<typeof mintPointId>;
  strokeWidth: number;
}) {
  const { font } = await newMemoryFontSource({ familyName: "Memory Test", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  const [source] = engine.fontRecords().sources;
  if (!source) throw new Error("a new font starts with one source");

  const intents = liveStrokeSetup(
    source.id,
    options.layerId,
    options.glyphId,
    options.contourId,
    options.startId,
    options.endId,
    options.strokeWidth,
  );

  engine.beginEdit(null);
  engine.apply(intents);
  engine.endEdit();

  const session = memoryFontSession(engine, { clipboard: new MemoryClipboard() });
  return {
    session,
    engine,
    dispose: () => session.dispose(),
  };
}

function liveStrokeSetup(
  sourceId: SourceId,
  layerId: LayerId,
  glyphId: ReturnType<typeof mintGlyphId>,
  contourId: ReturnType<typeof mintContourId>,
  startId: ReturnType<typeof mintPointId>,
  endId: ReturnType<typeof mintPointId>,
  width: number,
): readonly FontIntent[] {
  return [
    ...skeletonOnlySetup(sourceId, layerId, glyphId, contourId, startId, endId),
    {
      kind: "setLiveStroke",
      setLiveStroke: {
        layerId,
        contourIds: [contourId],
        style: { width, cap: "round", join: "round", miterLimit: 4, position: 0 },
      },
    },
  ];
}

function skeletonOnlySetup(
  sourceId: SourceId,
  layerId: LayerId,
  glyphId: ReturnType<typeof mintGlyphId>,
  contourId: ReturnType<typeof mintContourId>,
  startId: ReturnType<typeof mintPointId>,
  endId: ReturnType<typeof mintPointId>,
): readonly FontIntent[] {
  return [
    { kind: "createGlyph", createGlyph: { glyphId, name: "strokeExtent", unicodes: [] } },
    { kind: "createGlyphLayer", createGlyphLayer: { layerId, glyphId, sourceId } },
    {
      kind: "replaceGlyphLayerContent",
      replaceGlyphLayerContent: {
        layerId,
        width: 500,
        contours: [
          {
            id: contourId,
            closed: false,
            points: [point(startId, 0), point(endId, 100)],
          },
        ],
        anchors: [],
        components: [],
      },
    },
  ];
}

function point(id: ReturnType<typeof mintPointId>, x: number) {
  return {
    id,
    x,
    y: 0,
    pointType: "onCurve" as const,
    smooth: false,
  };
}
