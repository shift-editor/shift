import { beforeEach, describe, expect, it } from "vitest";
import { createBridge, type ShiftBridge } from "@shift/bridge";
import { effect, signal } from "@/lib/signals/signal";
import { defaultAxisLocation, withAxisValue } from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { Font } from "./Font";
import type { PointId } from "@shift/types";
import type { Glyph, GlyphSource } from "./Glyph";
import type { Point } from "@shift/glyph-state";

function editGlyph(): {
  bridge: ShiftBridge;
  font: Font;
  glyph: Glyph;
  layer: GlyphSource;
} {
  const bridge = createBridge();
  const font = new Font(bridge);
  font.load(MUTATORSANS_DESIGNSPACE);

  const handle = { name: "A" };
  const source = font.defaultSource;
  bridge.startEditSession(handle, source.id);

  const glyph = font.glyph(handle);
  if (!glyph) throw new Error("Expected edit glyph");
  const layer = font.glyphSource(handle, source);
  if (!layer) throw new Error("Expected edit glyph source");

  return { bridge, font, glyph, layer };
}

function addTriangle(layer: GlyphSource): readonly Point[] {
  const contourId = layer.addContour();

  layer.addPoint(contourId, {
    x: 0,
    y: 0,
    pointType: "onCurve",
    smooth: false,
  });
  layer.addPoint(contourId, {
    x: 100,
    y: 0,
    pointType: "onCurve",
    smooth: false,
  });
  layer.addPoint(contourId, {
    x: 50,
    y: 100,
    pointType: "onCurve",
    smooth: false,
  });

  layer.closeContour(contourId);

  const contour = layer.contours.at(-1);
  if (!contour) throw new Error("Expected created contour");
  return contour.points;
}

function pointPosition(
  layer: GlyphSource,
  pointId: PointId,
): { x: number; y: number } {
  const point = layer.point(pointId);
  if (!point) throw new Error("Expected point");

  return { x: point.x, y: point.y };
}

function sourcePosition(
  layer: GlyphSource,
  pointId: PointId,
): { x: number; y: number } {
  const position = layer.positionsFor([{ kind: "point", id: pointId }])[0];
  if (!position) throw new Error("Expected source position");

  return { x: position.x, y: position.y };
}

function loadMutatorSans(): Font {
  const font = new Font(createBridge());
  font.load(MUTATORSANS_DESIGNSPACE);

  return font;
}

function locationOverride(
  font: Font,
  override: Record<string, number>,
): AxisLocation {
  let location = defaultAxisLocation(font.getAxes());
  for (const axis of font.getAxes()) {
    if (override[axis.tag] !== undefined) {
      location = withAxisValue(location, axis, override[axis.tag]);
    }
  }

  return location;
}

describe("Glyph", () => {
  let glyph: Glyph;
  let layer: GlyphSource;

  beforeEach(() => {
    const { glyph: nextGlyph, layer: nextLayer } = editGlyph();

    glyph = nextGlyph;
    layer = nextLayer;
  });

  it("hydrates state from the active edit session", () => {
    expect(glyph.name).toBe("A");
    expect(glyph.unicode).toBeNull();
    expect(glyph.xAdvance).toBeGreaterThan(0);
    expect(glyph.contours.length).toBeGreaterThan(0);
  });

  it("applies structural edits returned by the bridge", () => {
    const points = addTriangle(layer);

    expect(layer.contours.at(-1)?.closed).toBe(true);

    expect(points.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [50, 100],
    ]);
  });

  it("updates positions through the packed position patch path", () => {
    const [first] = addTriangle(layer);

    layer.applyPositionPatch([{ kind: "point", id: first.id, x: 25, y: 75 }]);

    expect(glyph.point(first.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("exposes glyph sources as the authored geometry surface", () => {
    const font = loadMutatorSans();
    const source = font.defaultSource;

    const glyph = font.glyph({ name: "A" });

    expect(glyph).not.toBeNull();

    const glyphSource = font.glyphSource({ name: "A" }, source);
    if (!glyphSource) throw new Error("Expected glyph source");
    expect(glyphSource.source).toBe(source);

    const geometry = glyph!.geometryAt(font.defaultLocation());
    expect(glyphSource.geometry.xAdvance).toBe(geometry.xAdvance);
  });

  it("feeds consumers that track source coordinate changes before reading geometry", () => {
    const { glyph, layer } = editGlyph();
    const first = glyph.allPoints[0];
    if (!first) throw new Error("Expected point");
    let pointX = first.x;

    const subscription = effect(() => {
      layer.coordinateBuffersChangedCell.value;
      pointX = glyph.point(first.id)?.x ?? pointX;
    });

    layer.applyPositionPatch([{ kind: "point", id: first.id, x: 33, y: 44 }]);

    expect(pointX).toBe(33);
    subscription.dispose();
  });

  it("returns a serializable state for restore", () => {
    const [first] = addTriangle(layer);
    const state = glyph.toState();

    layer.applyPositionPatch([{ kind: "point", id: first.id, x: 300, y: 400 }]);
    layer.restore(state);

    expect(glyph.point(first.id)).toMatchObject({ x: 0, y: 0 });
  });
});

describe("glyph sources keep public geometry coherent across position edits", () => {
  let glyph: Glyph;
  let layer: GlyphSource;

  beforeEach(() => {
    const { glyph: nextGlyph, layer: nextLayer } = editGlyph();

    glyph = nextGlyph;
    layer = nextLayer;
  });

  it("previews point patches through every public source geometry view", () => {
    const [, second] = addTriangle(layer);

    layer.previewPositionPatch([
      { kind: "point", id: second.id, x: 25, y: 75 },
    ]);

    expect(sourcePosition(layer, second.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second.id)).toEqual({ x: 25, y: 75 });
    expect(layer.contours.at(-1)?.points[1]).toMatchObject({ x: 25, y: 75 });
    expect(
      layer.allPoints.find((point) => point.id === second.id),
    ).toMatchObject({
      x: 25,
      y: 75,
    });
    expect(layer.bounds).toEqual(glyph.bounds);
  });

  it("applies bridge-backed point patches to the source and owning glyph geometry", () => {
    const [, second] = addTriangle(layer);

    layer.applyPositionPatch([{ kind: "point", id: second.id, x: 25, y: 75 }]);

    expect(sourcePosition(layer, second.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second.id)).toEqual({ x: 25, y: 75 });
    expect(glyph.point(second.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("commits a preview without stale geometry or double-applying local positions", () => {
    const [, second] = addTriangle(layer);

    layer.previewPositionPatch([
      { kind: "point", id: second.id, x: 25, y: 75 },
    ]);
    layer.commitPositionPatch([{ kind: "point", id: second.id, x: 25, y: 75 }]);

    expect(sourcePosition(layer, second.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second.id)).toEqual({ x: 25, y: 75 });

    const committed = layer.positionsFor([{ kind: "point", id: second.id }])[0];
    if (!committed) throw new Error("Expected committed position");

    layer.previewPositionPatch([
      { kind: "point", id: second.id, x: committed.x + 10, y: committed.y + 5 },
    ]);

    expect(pointPosition(layer, second.id)).toEqual({ x: 35, y: 80 });
  });
});

describe("Glyph variation interpolation", () => {
  let font: Font;
  let glyph: Glyph;

  beforeEach(() => {
    font = loadMutatorSans();

    const nextGlyph = font.glyph({ name: "A" });
    if (!nextGlyph) throw new Error("Expected glyph");
    glyph = nextGlyph;
  });

  it("returns glyph sources for matching font sources", () => {
    const sources = font.sources;
    expect(sources.length).toBeGreaterThan(0);

    const resolved = [];
    for (const source of sources) {
      const glyphSource = font.glyphSource(glyph.handle, source);
      if (glyphSource) resolved.push(glyphSource);
    }

    expect(resolved.length).toBeGreaterThan(0);
    expect(
      resolved.every((glyphSource) => glyphSource.source.id === glyphSource.id),
    ).toBe(true);
  });

  it("root glyph svgPath changes when the variation location moves", () => {
    const location = signal(font.defaultLocation());
    const atDefault = glyph!.outline(location).svgPath;
    const axes = font.getAxes();
    location.set(
      locationOverride(
        font,
        Object.fromEntries(axes.map((a) => [a.tag, a.maximum])),
      ),
    );

    expect(glyph!.outline(location).svgPath).not.toBe(atDefault);
  });

  it("returns concrete shapes at requested design locations", () => {
    const axes = font.getAxes();
    const atDefault = glyph!.instanceAt(font.defaultLocation()).geometry;
    const atMaximum = glyph!.instanceAt(
      locationOverride(
        font,
        Object.fromEntries(axes.map((axis) => [axis.tag, axis.maximum])),
      ),
    ).geometry;

    expect(atMaximum.xAdvance).not.toBe(atDefault.xAdvance);
    expect(atMaximum.contours.flatMap((contour) => contour.points)).not.toEqual(
      atDefault.contours.flatMap((contour) => contour.points),
    );
  });

  it("pure composites include component geometry in svgPath", () => {
    const font = loadMutatorSans();

    const glyph = font.glyph({ name: "Aacute" });
    expect(glyph).not.toBeNull();

    const location = signal(font.defaultLocation());
    const atDefault = glyph!.outline(location).svgPath;
    const axes = font.getAxes();
    location.set(
      locationOverride(
        font,
        Object.fromEntries(axes.map((a) => [a.tag, a.maximum])),
      ),
    );

    expect(glyph!.contours).toEqual([]);
    expect(atDefault.length).toBeGreaterThan(0);
    expect(glyph!.outline(location).svgPath).not.toEqual(atDefault);
  });
});
