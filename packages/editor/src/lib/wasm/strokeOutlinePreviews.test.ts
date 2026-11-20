import { describe, expect, it } from "vitest";
import {
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  type FontIntent,
  type LayerId,
  type OutlineStrokeStyle,
  type SourceId,
} from "@shift/types";
import { MemoryClipboard } from "../../testing/emptyMemorySession";
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { effect } from "../signals";
import { SessionEngine } from "../engine/SessionEngine";
import type { StrokeFills } from "../../types/graphics";
import { STROKE_PREVIEW_TOLERANCE, type LiveStroke } from "./engineModule";

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
      expect(previews.items).toHaveLength(1);
      expect(previews.items[0]!.skeletonContourId).toBe(contourId);
      expect(previews.items[0]!.outlines.length).toBeGreaterThan(0);
      expect(previews.items[0]!.width).toBeGreaterThan(100);
      expect(previews.items[0]!.height).toBeGreaterThan(0);
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
      expect(narrow.items).toHaveLength(1);
      const narrowHeight = narrow.items[0]!.height;

      engine.beginEdit(null);
      engine.apply([
        {
          kind: "setLiveStroke",
          setLiveStroke: {
            layerId,
            contourIds: [contourId],
            style: { width: 48, cap: "round", join: "round", miterLimit: 4, position: 0 },
          },
        },
      ]);
      engine.endEdit();

      const wide = session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE);
      expect(wide.items).toHaveLength(1);
      expect(wide.items[0]!.height).toBeGreaterThan(narrowHeight + 10);
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
      expect(session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE)).toEqual({
        items: [],
        failures: [],
      });
    } finally {
      dispose();
    }
  });

  it("reads the stored style of each dynamic contour and follows a restyle", async () => {
    const layerId = mintLayerId();
    const contourId = mintContourId();

    const { session, engine, dispose } = await strokePreviewSession({
      layerId,
      glyphId: mintGlyphId(),
      contourId,
      startId: mintPointId(),
      endId: mintPointId(),
      strokeWidth: 20,
    });

    try {
      const seen: (readonly LiveStroke[])[] = [];
      const subscription = effect(() => {
        seen.push(session.font.liveStrokes(layerId));
      });
      expect(session.font.liveStrokes(layerId)).toEqual([
        {
          contourId,
          style: { width: 20, cap: "round", join: "round", miterLimit: 4, position: 0 },
        },
      ]);

      const restyled: OutlineStrokeStyle = {
        width: 36,
        cap: "square",
        join: "miter",
        miterLimit: 6,
        position: -0.5,
      };
      engine.beginEdit(null);
      engine.apply([
        {
          kind: "setLiveStroke",
          setLiveStroke: { layerId, contourIds: [contourId], style: restyled },
        },
      ]);
      engine.endEdit();
      subscription.dispose();

      expect(seen.at(-1)).toEqual([{ contourId, style: restyled }]);
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
      expect(session.font.strokeOutlinePreviews(layerId, STROKE_PREVIEW_TOLERANCE)).toEqual({
        items: [],
        failures: [],
      });
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
        seenHeights.push(previews.items[0]?.height ?? 0);
      });

      engine.beginEdit(null);
      engine.apply([
        {
          kind: "setLiveStroke",
          setLiveStroke: {
            layerId,
            contourIds: [contourId],
            style: { width: 48, cap: "round", join: "round", miterLimit: 4, position: 0 },
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

  describe("solved stroke fills", () => {
    it("hands every reader the same value until something changes the strokes", async () => {
      const layerId = mintLayerId();
      const { session, dispose } = await strokePreviewSession(sessionIds(layerId));

      try {
        const fillsCell = session.font.strokeFillsCell(layerId);
        const seen: StrokeFills[] = [];
        const subscription = effect(() => {
          seen.push(fillsCell.value);
        });

        const first = fillsCell.peek();
        expect(first.items).toHaveLength(1);
        expect(first.path).toBeInstanceOf(Path2D);
        expect(session.font.strokeFillsCell(layerId).peek()).toBe(first);
        expect(fillsCell.peek()).toBe(first);
        subscription.dispose();

        expect(new Set(seen).size).toBe(1);
      } finally {
        dispose();
      }
    });

    it("hands out a new value when the stroke is restyled", async () => {
      const ids = sessionIds(mintLayerId());
      const { session, engine, dispose } = await strokePreviewSession(ids);

      try {
        const fillsCell = session.font.strokeFillsCell(ids.layerId);
        const before = fillsCell.peek();

        engine.beginEdit(null);
        engine.apply([
          {
            kind: "setLiveStroke",
            setLiveStroke: {
              layerId: ids.layerId,
              contourIds: [ids.contourId],
              style: { width: 48, cap: "round", join: "round", miterLimit: 4, position: 0 },
            },
          },
        ]);
        engine.endEdit();

        const after = fillsCell.peek();
        expect(after).not.toBe(before);
        expect(after.items[0]!.height).toBeGreaterThan(before.items[0]!.height + 10);
      } finally {
        dispose();
      }
    });

    it("follows a gesture's preview frames and returns to the committed fills after it", async () => {
      const ids = sessionIds(mintLayerId());
      const { session, engine, dispose } = await strokePreviewSession(ids);

      try {
        const fillsCell = session.font.strokeFillsCell(ids.layerId);
        const committed = fillsCell.peek();

        engine.showPreview([
          {
            kind: "movePoints",
            movePoints: { layerId: ids.layerId, pointIds: [ids.endId], coords: [300, 0] },
          },
        ]);
        const inFlight = fillsCell.peek();
        expect(inFlight).not.toBe(committed);
        expect(inFlight.items[0]!.width).toBeGreaterThan(committed.items[0]!.width + 150);

        engine.showPreview([
          {
            kind: "movePoints",
            movePoints: { layerId: ids.layerId, pointIds: [ids.endId], coords: [400, 0] },
          },
        ]);
        expect(fillsCell.peek().items[0]!.width).toBeGreaterThan(inFlight.items[0]!.width + 50);

        engine.endPreview();
        expect(fillsCell.peek().items).toEqual(committed.items);
      } finally {
        dispose();
      }
    });

    it("is empty, with no path, for a layer without a dynamic stroke", async () => {
      const ids = sessionIds(mintLayerId());
      const { session, dispose } = await strokePreviewSession({ ...ids, liveStroke: false });

      try {
        const fills = session.font.strokeFillsCell(ids.layerId).peek();

        expect(fills.items).toEqual([]);
        expect(fills.path).toBeNull();
        expect(fills.failure).toBeNull();
      } finally {
        dispose();
      }
    });

    it("says why a stroke cannot be solved when its skeleton collapses to a point", async () => {
      const ids = sessionIds(mintLayerId());
      const { session, engine, dispose } = await strokePreviewSession(ids);

      try {
        const fillsCell = session.font.strokeFillsCell(ids.layerId);
        expect(fillsCell.peek().failure).toBeNull();

        engine.showPreview([
          {
            kind: "movePoints",
            movePoints: { layerId: ids.layerId, pointIds: [ids.endId], coords: [0, 0] },
          },
        ]);
        const collapsed = fillsCell.peek();

        expect(collapsed.items).toEqual([]);
        expect(collapsed.path).toBeNull();
        expect(collapsed.failure).toMatch(/^A dynamic stroke could not be drawn: .+\.$/);
        expect(collapsed.failure).not.toContain("StrokePreviewReadError");

        engine.endPreview();
        expect(fillsCell.peek().failure).toBeNull();
      } finally {
        dispose();
      }
    });

    it("reports a layer the font does not have as a failure, not a throw", async () => {
      const { session, dispose } = await strokePreviewSession(sessionIds(mintLayerId()));

      try {
        const fills = session.font.strokeFillsCell(mintLayerId()).peek();

        expect(fills.items).toEqual([]);
        expect(fills.path).toBeNull();
        expect(fills.failure).not.toBeNull();
      } finally {
        dispose();
      }
    });
  });
});

function sessionIds(layerId: LayerId): StrokePreviewSessionIds {
  return {
    layerId,
    glyphId: mintGlyphId(),
    contourId: mintContourId(),
    startId: mintPointId(),
    endId: mintPointId(),
  };
}

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
        style: { width, cap: "round", join: "round", miterLimit: 4, position: 0 },
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
