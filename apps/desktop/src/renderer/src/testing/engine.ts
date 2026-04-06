import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { FontEngine } from "@/engine/FontEngine";
import { Glyphs } from "@shift/font";

export function createFontEngine(): FontEngine {
  const { FontEngine: NativeFontEngine } = require("shift-node");
  return new FontEngine(new NativeFontEngine());
}

export function getAllPoints(snapshot: GlyphSnapshot | null): PointSnapshot[] {
  if (!snapshot) return [];
  return Glyphs.getAllPoints(snapshot);
}

export function getPointCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return Glyphs.getAllPoints(snapshot).length;
}
