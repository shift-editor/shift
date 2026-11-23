import { describe, expect, it } from "vitest";
import {
  asAxisId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  mintSourceId,
  type FontIntent,
  type LayerId,
  type SourceId,
} from "@shift/types";
import { MemoryClipboard } from "../../testing/emptyMemorySession";
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { SessionEngine } from "../engine/SessionEngine";
import { asDesignAxisLocation } from "../variation/location";
import { STROKE_PREVIEW_TOLERANCE } from "./engineModule";

const axisId = asAxisId("axis_weight_interp");
const glyphId = mintGlyphId();
const regularLayerId = mintLayerId();
const boldLayerId = mintLayerId();
const boldSourceId = mintSourceId();
const regularContourId = mintContourId();
const boldContourId = mintContourId();

/** An open 200-long line from (`x`, 0), stroked `width` wide, on `layerId` in `sourceId`. */
function strokedLine(
  layerId: LayerId,
  sourceId: SourceId,
  contourId: ReturnType<typeof mintContourId>,
  x: number,
  width: number,
): FontIntent[] {
  const startId = mintPointId();
  const endId = mintPointId();
  const point = (id: typeof startId, at: number) => ({
    id,
    x: at,
    y: 0,
    pointType: "onCurve" as const,
    smooth: false,
  });

  return [
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
            points: [point(startId, x), point(endId, x + 200)],
          },
        ],
        anchors: [],
        components: [],
      },
    },
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

/**
 * A session over a variable font: wght 0–1000, Regular at 0 stroking a line
 * 100..300 at width 20, Bold at 1000 stroking the line 300..500 at width 60.
 */
async function interpolatedStrokeSession() {
  const { font } = await newMemoryFontSource({ familyName: "Memory Test", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  const [regular] = engine.fontRecords().sources;
  if (!regular) throw new Error("a new font starts with one source");

  const intents: FontIntent[] = [
    {
      kind: "createAxis",
      createAxis: {
        axis: {
          id: axisId,
          tag: "wght",
          name: "Weight",
          role: "external",
          kind: { kind: "continuous", minimum: 0, default: 0, maximum: 1000 },
          labels: [],
          hidden: false,
        },
      },
    },
    {
      kind: "createSource",
      createSource: {
        sourceId: boldSourceId,
        name: "Bold",
        location: { values: { [axisId]: 1000 } },
      },
    },
    { kind: "createGlyph", createGlyph: { glyphId, name: "interpStroke", unicodes: [] } },
    ...strokedLine(regularLayerId, regular.id, regularContourId, 100, 20),
    ...strokedLine(boldLayerId, boldSourceId, boldContourId, 300, 60),
  ];

  engine.beginEdit(null);
  engine.apply(intents);
  engine.endEdit();

  const session = memoryFontSession(engine, { clipboard: new MemoryClipboard() });
  return { session, dispose: () => session.dispose() };
}

describe("stroke outline previews at an interpolated location", () => {
  it("solves the stroke around the interpolated skeleton at the interpolated width", async () => {
    const { session, dispose } = await interpolatedStrokeSession();

    try {
      // Halfway: the skeleton runs 200..400 and the width is 40, so the
      // outline spans 240 wide and 40 high.
      const previews = session.font.strokeOutlinePreviewsAt(
        glyphId,
        asDesignAxisLocation(new Map([[axisId, 500]])),
        STROKE_PREVIEW_TOLERANCE,
      );

      expect(previews.failures).toEqual([]);
      expect(previews.items).toHaveLength(1);
      expect(previews.items[0]!.skeletonContourId).toBe(regularContourId);
      expect(previews.items[0]!.width).toBeCloseTo(240, 0);
      expect(previews.items[0]!.height).toBeCloseTo(40, 0);
    } finally {
      dispose();
    }
  });

  it("at a master, answers what that master's own layer read answers", async () => {
    const { session, dispose } = await interpolatedStrokeSession();

    try {
      const atRegular = session.font.strokeOutlinePreviewsAt(
        glyphId,
        asDesignAxisLocation(new Map([[axisId, 0]])),
        STROKE_PREVIEW_TOLERANCE,
      );
      const own = session.font.strokeOutlinePreviews(regularLayerId, STROKE_PREVIEW_TOLERANCE);

      expect(atRegular.items).toHaveLength(1);
      expect(atRegular.items[0]!.skeletonContourId).toBe(regularContourId);
      expect(atRegular.items[0]!.width).toBeCloseTo(own.items[0]!.width, 6);
      expect(atRegular.items[0]!.height).toBeCloseTo(own.items[0]!.height, 6);
    } finally {
      dispose();
    }
  });
});
