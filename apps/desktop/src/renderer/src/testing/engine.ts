import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { FontEngine, MockFontEngine } from "@/engine";
import { Glyphs } from "@shift/font";

export function createMockFontEngine(): FontEngine {
  return new FontEngine(new MockFontEngine());
}

export function getAllPoints(snapshot: GlyphSnapshot | null): PointSnapshot[] {
  if (!snapshot) return [];
  return Glyphs.getAllPoints(snapshot);
}

export function getPointCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return Glyphs.getAllPoints(snapshot).length;
}

export function getContourCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.contours.length;
}
