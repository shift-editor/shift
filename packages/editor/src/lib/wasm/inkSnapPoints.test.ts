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
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { SessionEngine } from "../engine/SessionEngine";
import { MemoryClipboard } from "../../testing/emptyMemorySession";

describe("ink snap points through the WASM engine", () => {
  it("returns ink snap points for a stroked layer", async () => {
    const layerId = mintLayerId();
    const contourId = mintContourId();
    const { engine, dispose } = await inkSnapSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId,
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      const contours = engine.inkSnapPoints(layerId);
      console.log("ink snap contours:", JSON.stringify(contours));
      expect(contours.length).toBeGreaterThan(0);
      expect(contours[0]!.skeletonContourId).toBe(contourId);
      expect(contours[0]!.coordinates.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it("returns empty for a layer without strokes", async () => {
    const layerId = mintLayerId();
    const { engine, dispose } = await inkSnapSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId: mintContourId(),
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
      liveStroke: false,
    });

    try {
      const contours = engine.inkSnapPoints(layerId);
      expect(contours).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("includeStrokeInMetrics is true by default", async () => {
    const { engine, dispose } = await inkSnapSession({
      layerId: mintLayerId(),
      glyphId: mintGlyphId(),
      contourId: mintContourId(),
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      const include = engine.includeStrokeInMetrics();
      console.log("includeStrokeInMetrics =", include);
      expect(include).toBe(true);
    } finally {
      dispose();
    }
  });

  it("ink snap points flow through Font.inkSnapContours", async () => {
    const layerId = mintLayerId();
    const contourId = mintContourId();
    const { session, engine, dispose } = await inkSnapSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId,
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 40,
    });

    try {
      const include = engine.includeStrokeInMetrics();
      console.log("engine.includeStrokeInMetrics() =", include);

      const fontInclude = session.font.includeStrokeInMetricsCell.peek();
      console.log("Font.includeStrokeInMetricsCell =", fontInclude);

      const engineContours = engine.inkSnapPoints(layerId);
      console.log("engine.inkSnapPoints:", engineContours.length, "contours");

      const inkContours = session.font.inkSnapContours(layerId);
      console.log("Font.inkSnapContours:", inkContours.length, "contours");
      for (const c of inkContours) {
        console.log(
          "  contour",
          c.skeletonContourId,
          "→",
          c.points.length,
          "points:",
          c.points.slice(0, 4),
        );
      }

      expect(inkContours.length).toBeGreaterThan(0);
      expect(inkContours[0]!.skeletonContourId).toBe(contourId);
      expect(inkContours[0]!.points.length).toBeGreaterThan(0);

      // A vertical stem at x=0, y=[0,100] with round stroke width 40:
      // ink edges should be at x ≈ -20 and x ≈ 20
      const allPoints = inkContours.flatMap((c) => c.points);
      const xs = allPoints.map((p) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      console.log("ink x range:", minX, "→", maxX);
      expect(minX).toBeLessThan(-15);
      expect(maxX).toBeGreaterThan(15);
    } finally {
      dispose();
    }
  });
});

interface InkSnapSessionIds {
  layerId: LayerId;
  glyphId: ReturnType<typeof mintGlyphId>;
  contourId: ReturnType<typeof mintContourId>;
  startId: ReturnType<typeof mintPointId>;
  endId: ReturnType<typeof mintPointId>;
  strokeWidth: number;
  liveStroke?: boolean;
}

async function inkSnapSession(ids: InkSnapSessionIds) {
  const { font } = await newMemoryFontSource({ familyName: "InkSnapTest", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  const [source] = engine.fontRecords().sources;
  if (!source) throw new Error("a new font starts with one source");

  const intents = buildIntents(source.id, ids);
  engine.beginEdit(null);
  engine.apply(intents);
  engine.endEdit();

  const session = memoryFontSession(engine, { clipboard: new MemoryClipboard() });
  return { session, engine, dispose: () => session.dispose() };
}

function buildIntents(sourceId: SourceId, ids: InkSnapSessionIds): readonly FontIntent[] {
  const base: FontIntent[] = [
    { kind: "createGlyph", createGlyph: { glyphId: ids.glyphId, name: "inkSnap", unicodes: [] } },
    {
      kind: "createGlyphLayer",
      createGlyphLayer: { layerId: ids.layerId, glyphId: ids.glyphId, sourceId },
    },
    {
      kind: "replaceGlyphLayerContent",
      replaceGlyphLayerContent: {
        layerId: ids.layerId,
        width: 500,
        contours: [
          {
            id: ids.contourId,
            closed: false,
            points: [
              { id: ids.startId, x: 0, y: 0, pointType: "onCurve", smooth: false },
              { id: ids.endId, x: 0, y: 100, pointType: "onCurve", smooth: false },
            ],
          },
        ],
        anchors: [],
        components: [],
      },
    },
  ];

  if (ids.liveStroke !== false) {
    base.push({
      kind: "setLiveStroke",
      setLiveStroke: {
        layerId: ids.layerId,
        contourIds: [ids.contourId],
        style: {
          width: ids.strokeWidth,
          cap: "round",
          join: "round",
          miterLimit: 4,
          position: 0,
        },
      },
    });
  }

  return base;
}
