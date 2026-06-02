import { createBridge } from "@shift/bridge";
import type { ContourId, PointId, PointType } from "@shift/types";
import { signal, type Signal } from "@/lib/signals/signal";
import { Font } from "@/lib/model/Font";
import type { GlyphSource } from "@/lib/model/Glyph";
import { Point } from "@shift/glyph-state";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import type { CommandContext } from "./core";

export interface CommandSourceFixture {
  readonly source: GlyphSource;
  readonly $source: Signal<GlyphSource | null>;
  readonly ctx: CommandContext;
}

export function commandSourceFixture(): CommandSourceFixture {
  const bridge = createBridge();
  const font = new Font(bridge);
  font.load(MUTATORSANS_DESIGNSPACE);

  const handle = { name: "A", unicode: 65 };
  const source = font.defaultSource;

  const glyphSource = font.glyphSource(handle, source);
  if (!glyphSource) throw new Error("Expected editable glyph source");
  return {
    source: glyphSource,
    $source: signal<GlyphSource | null>(glyphSource),
    ctx: { source: glyphSource },
  };
}

export function addContour(source: GlyphSource): ContourId {
  return source.addContour();
}

export function addPoint(
  source: GlyphSource,
  contourId: ContourId,
  edit: {
    readonly x: number;
    readonly y: number;
    readonly pointType?: PointType;
    readonly smooth?: boolean;
  },
): PointId {
  return source.addPoint(
    contourId,
    Point.create({ x: edit.x, y: edit.y }, edit.pointType ?? "onCurve", edit.smooth ?? false),
  );
}

export function point(source: GlyphSource, pointId: PointId): Point {
  const result = source.point(pointId);
  if (!result) throw new Error("Expected point");
  return result;
}

export function contourPoints(source: GlyphSource, contourId: ContourId): readonly Point[] {
  const contour = source.contour(contourId);
  if (!contour) throw new Error("Expected contour");
  return contour.points;
}
