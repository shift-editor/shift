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
import { MemoryClipboard } from "../../testing/emptyMemorySession";
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { effect } from "../signals";
import { SessionEngine } from "../engine/SessionEngine";
import { STROKE_PREVIEW_TOLERANCE } from "./engineModule";

describe("stroke outline previews", () => {
  it("returns outline count and bounds after SetLiveStroke", async () => {
    const layerId = mintLayerId();
    const glyphId = mintGlyphId();
    const contourId = mintContourId();
    const startId = mintPointId();
    const endId = mintPointId();

    const { session, dispose } = await strokePreviewSession({
      layerId,
      glyphId,
      contourId,
      startId,
      endId,
      strokeWidth: 20,
    });

    try {
      const previews = session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE);
      expect(previews).toHaveLength(1);
      expect(previews[0]!.skeletonContourId).toBe(contourId);
      expect(previews[0]!.outlines.length).toBeGreaterThan(0);
      expect(previews[0]!.width).toBeGreaterThan(100);
      expect(previews[0]!.height).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it("grows outline bounds when live stroke width increases", async () => {
    const layerId = mintLayerId();
    const glyphId = mintGlyphId();
    const contourId = mintContourId();
    const startId = mintPointId();
    const endId = mintPointId();

    const { session, engine, dispose } = await strokePreviewSession({
      layerId,
      glyphId,
      contourId,
      startId,
      endId,
      strokeWidth: 20,
    });

    try {
      const narrow = session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE);
      expect(narrow).toHaveLength(1);
      const narrowHeight = narrow[0]!.height;

      engine.beginEdit(null);
      engine.apply([
        {
          kind: "setLiveStroke",
          setLiveStroke: {
            layerId,
            contourIds: [contourId],
            style: { width: 48, cap: "round", join: "round", miterLimit: 4 },
          },
        },
      ]);
      engine.endEdit();

      const wide = session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE);
      expect(wide).toHaveLength(1);
      expect(wide[0]!.height).toBeGreaterThan(narrowHeight + 10);
    } finally {
      dispose();
    }
  });

  it("returns an empty list when the layer has no live stroke", async () => {
    const layerId = mintLayerId();
    const glyphId = mintGlyphId();
    const contourId = mintContourId();
    const startId = mintPointId();
    const endId = mintPointId();

    const { session, dispose } = await strokePreviewSession({
      layerId,
      glyphId,
      contourId,
      startId,
      endId,
      liveStroke: false,
    });

    try {
      expect(session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE)).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("lists the contours with a dynamic stroke and follows removal", async () => {
    const layerId = mintLayerId();
    const contourId = mintContourId();

    const { session, engine, dispose } = await strokePreviewSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId,
      startId: mintPointId(),
      endId: mintPointId(),
    });

    try {
      const seen: (readonly string[])[] = [];
      const subscription = effect(() => {
        seen.push(session.font.liveStrokeContours(layerId));
      });
      expect(session.font.liveStrokeContours(layerId)).toEqual([contourId]);

      engine.beginEdit(null);
      engine.apply([
        { kind: "removeLiveStroke", removeLiveStroke: { layerId, contourIds: [contourId] } },
      ]);
      engine.endEdit();
      subscription.dispose();

      expect(session.font.liveStrokeContours(layerId)).toEqual([]);
      expect(seen.at(-1)).toEqual([]);
      expect(session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE)).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("re-runs reactive readers after live stroke width changes", async () => {
    const layerId = mintLayerId();
    const glyphId = mintGlyphId();
    const contourId = mintContourId();
    const startId = mintPointId();
    const endId = mintPointId();

    const { session, engine, dispose } = await strokePreviewSession({
      layerId,
      glyphId,
      contourId,
      startId,
      endId,
      strokeWidth: 20,
    });

    try {
      const seenHeights: number[] = [];
      const subscription = effect(() => {
        const previews = session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE);
        seenHeights.push(previews[0]?.height ?? 0);
      });

      engine.beginEdit(null);
      engine.apply([
        {
          kind: "setLiveStroke",
          setLiveStroke: {
            layerId,
            contourIds: [contourId],
            style: { width: 48, cap: "round", join: "round", miterLimit: 4 },
          },
        },
      ]);
      engine.endEdit();
      subscription.dispose();

      expect(seenHeights.length).toBeGreaterThanOrEqual(2);
      expect(seenHeights.at(-1)).toBeGreaterThan(seenHeights[0]! + 10);
    } finally {
      dispose();
    }
  });
});

interface StrokePreviewSessionIds {
  layerId: LayerId;
  glyphId: ReturnType<typeof mintGlyphId>;
  contourId: ReturnType<typeof mintContourId>;
  startId: ReturnType<typeof mintPointId>;
  endId: ReturnType<typeof mintPointId>;
}

async function strokePreviewSession(
  ids: StrokePreviewSessionIds & { liveStroke?: boolean; strokeWidth?: number },
) {
  const { font } = await newMemoryFontSource({ familyName: "Memory Test", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  const [source] = engine.fontRecords().sources;
  if (!source) throw new Error("a new font starts with one source");

  const liveStroke = ids.liveStroke ?? true;
  const strokeWidth = ids.strokeWidth ?? 20;
  const intents = liveStroke
    ? liveStrokeSetup(
        source.id,
        ids.layerId,
        ids.glyphId,
        ids.contourId,
        ids.startId,
        ids.endId,
        strokeWidth,
      )
    : skeletonOnlySetup(source.id, ids.layerId, ids.glyphId, ids.contourId, ids.startId, ids.endId);

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

function skeletonOnlySetup(
  sourceId: SourceId,
  layerId: LayerId,
  glyphId: ReturnType<typeof mintGlyphId>,
  contourId: ReturnType<typeof mintContourId>,
  startId: ReturnType<typeof mintPointId>,
  endId: ReturnType<typeof mintPointId>,
): readonly FontIntent[] {
  return [
    { kind: "createGlyph", createGlyph: { glyphId, name: "strokePreview", unicodes: [] } },
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
        style: { width, cap: "round", join: "round", miterLimit: 4 },
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
