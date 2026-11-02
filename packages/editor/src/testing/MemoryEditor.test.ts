import { scenePoint } from "../lib/editor/spaces";
import { describe, expect, it } from "vitest";
import {
  asAxisId,
  asContourId,
  asGlyphId,
  asLayerId,
  asPointId,
  asSourceId,
  mintRunId,
  type FontIntent,
  type LayerId,
  type PointId,
  type SourceId,
} from "@shift/types";
import { externalAxisLocationFromRecord } from "../lib/variation/location";
import type { MemoryFontSession, MemoryToolName } from "../types/fontSession";
import type { GlyphNode, TextRunNode } from "../types/node";
import { startMemorySession } from "./emptyMemorySession";

const glyphId = asGlyphId("glyph_s");
const boldSourceId = asSourceId("source_bold");
const regularLayerId = asLayerId("layer_regular");
const boldLayerId = asLayerId("layer_bold");
const regularPointId = asPointId("point_regular_start");
const regularEndPointId = asPointId("point_regular_end");
const boldPointId = asPointId("point_bold_start");
const boldEndPointId = asPointId("point_bold_end");
const axisId = asAxisId("axis_weight");

/** A session over a font with a weight axis, Regular at 0 and Bold at 1000, and an open stroke `S`. */
interface StrokeFont {
  readonly session: MemoryFontSession;
  readonly regularSourceId: SourceId;
}

async function strokeFont(tools?: readonly MemoryToolName[]): Promise<StrokeFont> {
  let regularSourceId: SourceId | null = null;
  const session = await startMemorySession({
    tools,
    build: ({ sourceId }) => {
      regularSourceId = sourceId;
      return strokeIntents(sourceId);
    },
  });
  if (!regularSourceId) throw new Error("the font was built without its default source");
  return { session, regularSourceId };
}

describe("memory font editing", () => {
  it("loads a glyph from the engine and retains a Select-tool point drag in memory", async () => {
    const { session, regularSourceId } = await strokeFont();
    const { editor, font } = session;

    expect(editor.scene.nodes()).toEqual([]);

    editor.selectSource(regularSourceId);
    const loadedGlyph = await font.loadGlyph(glyphId);
    editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId,
      sourceId: regularSourceId,
      position: { x: 0, y: 0 },
    });

    const midpoint = externalAxisLocationFromRecord({ [axisId]: 500 });
    expect(loadedGlyph.geometryAt(midpoint).point(regularPointId)).toMatchObject({
      x: 200,
      y: 100,
    });

    expect(editor.getPointerTarget(scenePoint(100, -100)).kind).toBe("point");
    expect(editor.positionSelection([regularPointId])).not.toBeNull();

    const down = editor.sceneToScreen(scenePoint(100, -100));
    const start = editor.sceneToScreen(scenePoint(104, -100));
    const end = editor.sceneToScreen(scenePoint(150, -125));
    const modifiers = { shiftKey: false, altKey: false, metaKey: false };

    editor.toolManager.handlePointerDown(down, modifiers);
    editor.toolManager.handlePointerMove(start, modifiers, { force: true });
    editor.toolManager.flushPointerMoves();
    editor.toolManager.handlePointerMove(end, modifiers, { force: true });
    editor.toolManager.flushPointerMoves();
    editor.toolManager.handlePointerUp(end, modifiers);

    expect(loadedGlyph.layerForSource(regularSourceId)?.point(regularPointId)).toMatchObject({
      x: 150,
      y: 125,
    });
    expect(loadedGlyph.geometryAt(midpoint).point(regularPointId)).toMatchObject({
      x: 225,
      y: 112.5,
    });

    session.dispose();
  });

  it("shapes and lays proof text out through the session's engine", async () => {
    const { session, regularSourceId } = await strokeFont();
    const { editor } = session;
    editor.selectSource(regularSourceId);
    const run = editor.scene.createNode<TextRunNode>(
      {
        kind: "textRun",
        parentId: editor.pages.ensure().id,
        runId: mintRunId(),
        size: 1000,
        position: { x: 0, y: 0 },
      },
      editor.text.itemsFromText("SS"),
    );

    // S advances 500 at Regular; the caret stops come from the layout.
    await expect
      .poll(() => {
        const layout = editor.text.layout(run.runId);
        return {
          lefts: layout?.placedGlyphs.map((placed) => placed.left),
          carets: [0, 1, 2].map((cluster) => layout?.caretPosition(cluster).x),
        };
      })
      .toEqual({ lefts: [0, 500], carets: [0, 500, 1000] });

    session.dispose();
  });

  it("keeps axis state isolated between independent editor sessions", async () => {
    const { session: first } = await strokeFont();
    const { session: second } = await strokeFont();
    const secondLocation = second.editor.externalLocation;

    first.editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 625 }));

    expect(first.editor.externalLocation.get(axisId)).toBe(625);
    expect(second.editor.externalLocation).toBe(secondLocation);
    expect(second.editor.externalLocation.has(axisId)).toBe(false);

    first.dispose();
    second.dispose();
  });

  it("offers only the requested tools and activates the first", async () => {
    const { session: defaults } = await strokeFont();
    const { session: handOnly } = await strokeFont(["hand"]);
    const { session: viewOnly } = await strokeFont([]);

    expect([...defaults.editor.toolRegistryCell.peek().keys()]).toEqual(["select", "hand"]);
    expect(defaults.editor.toolCell.peek()?.id).toBe("select");
    expect([...handOnly.editor.toolRegistryCell.peek().keys()]).toEqual(["hand"]);
    expect(handOnly.editor.toolCell.peek()?.id).toBe("hand");
    expect(viewOnly.editor.toolRegistryCell.peek().size).toBe(0);
    expect(viewOnly.editor.toolCell.peek()).toBeNull();

    defaults.dispose();
    handOnly.dispose();
    viewOnly.dispose();
  });

  it("narrows the active tool to its identity and to one tool's state", async () => {
    const { session } = await strokeFont();
    const { editor } = session;
    const toolId = editor.toolIdCell;
    const select = editor.toolCellIf("select");
    const hand = editor.toolCellIf("hand");
    const modifiers = { shiftKey: false, altKey: false, metaKey: false };

    editor.toolManager.handlePointerDown(editor.sceneToScreen(scenePoint(-500, 500)), modifiers);
    editor.toolManager.handlePointerMove(editor.sceneToScreen(scenePoint(-400, 400)), modifiers, {
      force: true,
    });
    editor.toolManager.flushPointerMoves();

    expect(select.peek()).toBe(editor.toolManager.activeTool);
    expect(select.peek()?.state.type).not.toBe("idle");
    expect(toolId.peek()).toBe("select");
    expect(hand.peek()).toBeNull();

    editor.toolManager.handlePointerUp(editor.sceneToScreen(scenePoint(-400, 400)), modifiers);
    editor.setActiveTool("hand");

    expect(toolId.peek()).toBe("hand");
    expect(select.peek()).toBeNull();
    expect(hand.peek()?.id).toBe("hand");
    expect(editor.toolCellIf("hand")).toBe(hand);

    session.dispose();
  });

  it("disposes a session idempotently", async () => {
    const { session } = await strokeFont();
    expect(session.editor.toolCell.peek()?.id).toBe("select");
    expect(session.editor.toolRegistryCell.peek().size).toBeGreaterThan(0);

    session.dispose();

    expect(session.editor.toolCell.peek()).toBeNull();
    expect(session.editor.toolRegistryCell.peek().size).toBe(0);
    expect(() => session.dispose()).not.toThrow();
  });
});

/** The intents that add the weight axis, Bold, and `S` drawn as one open stroke in each source. */
function strokeIntents(regularSourceId: SourceId): FontIntent[] {
  return [
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
    { kind: "createGlyph", createGlyph: { glyphId, name: "S", unicodes: [83] } },
    ...stroke(regularLayerId, regularSourceId, [regularPointId, regularEndPointId], 100),
    ...stroke(boldLayerId, boldSourceId, [boldPointId, boldEndPointId], 300),
  ];
}

/** A layer of `S` in `sourceId`, 500 wide, with one open stroke 200 long from (`x`, 100). */
function stroke(
  layerId: LayerId,
  sourceId: SourceId,
  [start, end]: readonly [PointId, PointId],
  x: number,
): FontIntent[] {
  const point = (id: PointId, at: number) => ({
    id,
    x: at,
    y: 100,
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
            id: asContourId(`contour_${layerId}`),
            closed: false,
            points: [point(start, x), point(end, x + 200)],
          },
        ],
        anchors: [],
        components: [],
      },
    },
  ];
}
